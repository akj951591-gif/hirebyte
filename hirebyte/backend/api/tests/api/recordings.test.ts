import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { VALID_SIGNATURE } from './fakes.js';
import { buildTestApp, candidateAgent, createRecruiter, readyInterview, recruiterAgent, resetDb, startInterview, testDb, type TestAppOptions } from './helpers.js';

async function setup(opts: TestAppOptions = {}, config: Record<string, unknown> = {}) {
  const t = buildTestApp(opts);
  await createRecruiter();
  const recruiter = await recruiterAgent(t.app);
  const ready = await readyInterview(recruiter, config);
  const candidate = await candidateAgent(t.app, ready.invitation);
  return { ...t, recruiter, ...ready, candidate };
}

function webhook(app: Parameters<typeof request>[0], body: Record<string, unknown>, signature = VALID_SIGNATURE) {
  return request(app)
    .post('/api/webhooks/livekit/egress')
    .set('Authorization', signature)
    .set('Content-Type', 'application/webhook+json')
    .send(JSON.stringify({ createdAt: new Date().toISOString(), ...body }));
}

const egressEvent = (id: string, egressId: string, state: string, file: Record<string, unknown> | null = null) => ({
  id,
  event: state === 'ACTIVE' ? 'egress_started' : state === 'COMPLETE' || state === 'FAILED' ? 'egress_ended' : 'egress_updated',
  egress: { egressId, roomName: 'ignored', state, error: state === 'FAILED' ? 'boom' : null, file },
});

describe('media tokens and phone pairing (PRD §9.1)', () => {
  beforeEach(resetDb);

  it('answers "not configured" when LiveKit settings are missing', async () => {
    const { app, id, candidate } = await setup();
    const res = await candidate.agent.post(`/api/interviews/${id}/media-token`).send({ device: 'primary' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('MEDIA_NOT_CONFIGURED');
    expect((await request(app).post(`/api/interviews/${id}/media-token`).send({ device: 'secondary', pairingToken: 'x'.repeat(30) })).status).toBe(503);
  });

  it('issues role-scoped tokens: laptop publishes, recruiter watches hidden, others are refused', async () => {
    const { app, id, candidate, recruiter, media } = await setup({ media: true });
    const laptop = await candidate.agent.post(`/api/interviews/${id}/media-token`).send({ device: 'primary' });
    expect(laptop.status).toBe(200);
    expect(laptop.body).toMatchObject({ url: 'wss://fake.livekit.test', room: `hb-${id}`, identity: `candidate-primary:${id}` });
    expect(media.tokens.at(-1)).toMatchObject({ canPublish: true, canSubscribe: false, sources: ['camera', 'microphone'], ttlSeconds: 600 });

    const viewer = await recruiter.post(`/api/interviews/${id}/media-token`).send({ device: 'viewer' });
    expect(viewer.status).toBe(200);
    expect(media.tokens.at(-1)).toMatchObject({ canPublish: false, canSubscribe: true, hidden: true });

    // No cookie at all, or the candidate asking for someone else's interview.
    expect((await request(app).post(`/api/interviews/${id}/media-token`).send({ device: 'primary' })).status).toBe(401);
    expect((await request(app).post(`/api/interviews/${id}/media-token`).send({ device: 'viewer' })).status).toBe(401);
    const otherId = '00000000-0000-4000-8000-000000000000';
    expect((await candidate.agent.post(`/api/interviews/${otherId}/media-token`).send({ device: 'primary' })).status).toBe(403);
  });

  it('pairs the phone with a one-time token from the QR link', async () => {
    const { app, id, candidate, media } = await setup({ media: true });
    const view = await candidate.agent.get(`/api/candidate/sessions/${candidate.sessionId}`);
    expect(view.body.secondaryCamera).toBe('OPTIONAL');
    expect(view.body.pairing.status).toBe('NOT_PAIRED');
    const url = new URL(view.body.pairing.url);
    expect(url.origin + url.pathname).toBe('http://localhost:5173/pair');
    const token = url.searchParams.get('token')!;

    // The QR stays stable while it is valid.
    expect((await candidate.agent.get(`/api/candidate/sessions/${candidate.sessionId}`)).body.pairing.url).toBe(view.body.pairing.url);
    // The stored value is a hash, not the token.
    const row = await testDb().mediaSession.findUniqueOrThrow({ where: { interviewId: id } });
    expect(row.pairingTokenHash).not.toBe(token);

    const phone = await request(app).post(`/api/interviews/${id}/media-token`).send({ device: 'secondary', pairingToken: token });
    expect(phone.status).toBe(200);
    expect(phone.body.identity).toBe(`candidate-secondary:${id}`);
    expect(media.tokens.at(-1)).toMatchObject({ canPublish: true, canSubscribe: false, sources: ['camera'] });

    // Single use.
    expect((await request(app).post(`/api/interviews/${id}/media-token`).send({ device: 'secondary', pairingToken: token })).status).toBe(401);
    expect((await candidate.agent.get(`/api/candidate/sessions/${candidate.sessionId}`)).body.pairing.status).toBe('PAIRED');
  });

  it('rejects expired pairing links and blocks start when a required phone is missing', async () => {
    const { app, id, candidate, clock } = await setup({ media: true }, { secondaryCamera: 'REQUIRED' });
    const view = await candidate.agent.get(`/api/candidate/sessions/${candidate.sessionId}`);
    const token = new URL(view.body.pairing.url).searchParams.get('token')!;
    await candidate.agent.post(`/api/candidate/sessions/${candidate.sessionId}/consent`).send({
      recordingNoticeVersion: 'rec-notice-2026-10', proctoringNoticeVersion: 'proc-notice-2026-10', recordingConsent: false, proctoringConsent: true,
    });
    const start = await candidate.agent.post(`/api/candidate/sessions/${candidate.sessionId}/start`);
    expect(start.body.error.code).toBe('SECONDARY_CAMERA_REQUIRED');

    clock.offsetMs = 11 * 60_000;
    const expired = await request(app).post(`/api/interviews/${id}/media-token`).send({ device: 'secondary', pairingToken: token });
    expect(expired.status).toBe(410);
  });

  it('turns phone connect/disconnect webhooks into reviewable observations', async () => {
    const { app, id, candidate, recruiter } = await setup({ media: true });
    await startInterview(candidate.agent, candidate.sessionId);
    const identity = `candidate-secondary:${id}`;
    expect((await webhook(app, { id: 'EV_p1', event: 'participant_joined', participant: { identity } })).status).toBe(200);
    expect((await webhook(app, { id: 'EV_p2', event: 'participant_left', participant: { identity } })).status).toBe(200);
    const detail = await recruiter.get(`/api/interviews/${id}`);
    expect(detail.body.live.secondaryCamera).toBe('DISCONNECTED');
    expect(detail.body.live.recentEvents.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['SECONDARY_CONNECTED', 'SECONDARY_DISCONNECTED']));
  });
});

describe('recording lifecycle (PRD §9.2)', () => {
  beforeEach(resetDb);

  it('does not record when the candidate declines, even if enabled', async () => {
    const { id, candidate, recruiter, egress } = await setup({ recordingEnabled: true }, { recordingEnabled: true });
    const view = await candidate.agent.get(`/api/candidate/sessions/${candidate.sessionId}`);
    expect(view.body.recording).toMatchObject({ enabled: true, retention: expect.stringContaining('30 days') });
    await startInterview(candidate.agent, candidate.sessionId, false);
    expect(egress.started).toHaveLength(0);
    expect((await recruiter.get(`/api/interviews/${id}/recordings`)).body.items).toEqual([]);
  });

  it('does not record when the server policy is off, even with consent', async () => {
    const { candidate, egress } = await setup({ media: true }, { recordingEnabled: true });
    expect((await candidate.agent.get(`/api/candidate/sessions/${candidate.sessionId}`)).body.recording.enabled).toBe(false);
    await startInterview(candidate.agent, candidate.sessionId, true);
    expect(egress.started).toHaveLength(0);
  });

  it('records with consent, follows webhooks to READY only after the file exists, and plays back securely', async () => {
    const { app, id, candidate, recruiter, egress, storage } = await setup({ recordingEnabled: true }, { recordingEnabled: true });
    await startInterview(candidate.agent, candidate.sessionId, true);

    expect(egress.started).toHaveLength(1);
    const { egressId, objectKey, roomName } = egress.started[0]!;
    expect(roomName).toBe(`hb-${id}`);
    expect(objectKey).toMatch(new RegExp(`^recordings/${id}/[0-9a-f-]{36}/composite\\.mp4$`));
    expect(objectKey).not.toMatch(/jamie/i);

    let list = await recruiter.get(`/api/interviews/${id}/recordings`);
    expect(list.body.items[0]).toMatchObject({ status: 'PENDING' });
    const recordingId = list.body.items[0].id;

    // A forged webhook is rejected and changes nothing.
    expect((await webhook(app, egressEvent('EV_bad', egressId, 'ACTIVE'), 'Bearer forged')).status).toBe(401);
    expect((await webhook(app, egressEvent('EV_1', egressId, 'ACTIVE'))).status).toBe(200);
    expect((await recruiter.get(`/api/interviews/${id}/recordings`)).body.items[0].status).toBe('RECORDING');

    // Playback is refused until READY.
    expect((await recruiter.post(`/api/recordings/${recordingId}/playback-url`)).body.error.code).toBe('RECORDING_NOT_READY');

    await candidate.agent.post(`/api/candidate/sessions/${candidate.sessionId}/complete`);
    expect(egress.stopped).toEqual([egressId]);
    expect((await recruiter.get(`/api/interviews/${id}/recordings`)).body.items[0].status).toBe('FINALIZING');

    // LiveKit uploaded the file to R2 and reports COMPLETE.
    storage.objects.set(objectKey, 4096);
    const ended = egressEvent('EV_2', egressId, 'COMPLETE', { filename: objectKey, sizeBytes: 4096, durationSeconds: 61.5 });
    expect((await webhook(app, ended)).status).toBe(200);
    // Duplicate delivery is a no-op.
    expect((await webhook(app, ended)).body.status).toBe('duplicate');
    // A late "ACTIVE" event cannot move it backwards.
    await webhook(app, egressEvent('EV_3', egressId, 'ACTIVE'));

    list = await recruiter.get(`/api/interviews/${id}/recordings`);
    expect(list.body.items[0]).toMatchObject({ status: 'READY', sizeBytes: 4096, durationSeconds: 61.5, mimeType: 'video/mp4' });
    expect((await recruiter.get('/api/interviews')).body.items[0].recordingStatus).toBe('READY');

    const playback = await recruiter.post(`/api/recordings/${recordingId}/playback-url`);
    expect(playback.status).toBe(200);
    expect(playback.headers['cache-control']).toBe('no-store');
    expect(playback.body.url).toContain(objectKey);
    expect(storage.signed.at(-1)).toEqual({ key: objectKey, ttl: 300 });
    // Audit records the issuance but never the signed URL.
    const audits = await testDb().auditEvent.findMany({ where: { action: 'recording.playback_url_issued' } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain('X-Amz-Signature');

    // Another recruiter cannot see, play or delete it.
    await createRecruiter('other@example.test', 'Other');
    const other = await recruiterAgent(app, 'other@example.test');
    expect((await other.post(`/api/recordings/${recordingId}/playback-url`)).status).toBe(404);
    expect((await other.delete(`/api/recordings/${recordingId}`)).status).toBe(404);
    expect((await other.get(`/api/interviews/${id}/recordings`)).status).toBe(404);
    // Candidates never get recording administration.
    expect((await candidate.agent.post(`/api/recordings/${recordingId}/playback-url`)).status).toBe(401);
  });

  it('marks a recording FAILED when egress completes but the file is missing from R2', async () => {
    const { app, id, candidate, recruiter, egress } = await setup({ recordingEnabled: true }, { recordingEnabled: true });
    await startInterview(candidate.agent, candidate.sessionId, true);
    const { egressId } = egress.started[0]!;
    await candidate.agent.post(`/api/candidate/sessions/${candidate.sessionId}/complete`);
    await webhook(app, egressEvent('EV_m', egressId, 'COMPLETE', { filename: 'x', sizeBytes: 1, durationSeconds: 1 }));
    expect((await recruiter.get(`/api/interviews/${id}/recordings`)).body.items[0]).toMatchObject({ status: 'FAILED', failureCode: 'OBJECT_MISSING' });
  });

  it('keeps the interview running when egress fails to start', async () => {
    const { id, candidate, recruiter, egress } = await setup({ recordingEnabled: true }, { recordingEnabled: true });
    egress.failStart = true;
    const first = await startInterview(candidate.agent, candidate.sessionId, true);
    expect(first.status).toBe('IN_PROGRESS');
    expect((await recruiter.get(`/api/interviews/${id}/recordings`)).body.items[0]).toMatchObject({ status: 'FAILED', failureCode: 'EGRESS_START_FAILED' });
  });

  it('reconciles with LiveKit when webhooks never arrive', async () => {
    const { id, candidate, recruiter, egress, storage, clock } = await setup({ recordingEnabled: true }, { recordingEnabled: true });
    await startInterview(candidate.agent, candidate.sessionId, true);
    const { egressId, objectKey } = egress.started[0]!;
    await candidate.agent.post(`/api/candidate/sessions/${candidate.sessionId}/complete`);
    egress.states.set(egressId, { egressId, state: 'COMPLETE', error: null, file: { filename: objectKey, sizeBytes: 2048, durationSeconds: 30 } });
    storage.objects.set(objectKey, 2048);

    // Too soon: no provider call yet.
    expect((await recruiter.get(`/api/interviews/${id}/recordings`)).body.items[0].status).toBe('FINALIZING');
    clock.offsetMs = 20_000;
    expect((await recruiter.get(`/api/interviews/${id}/recordings`)).body.items[0].status).toBe('READY');
  });

  it('deletes from R2 before marking DELETED, and keeps the record if R2 fails', async () => {
    const { app, id, candidate, recruiter, egress, storage } = await setup({ recordingEnabled: true }, { recordingEnabled: true });
    await startInterview(candidate.agent, candidate.sessionId, true);
    const { egressId, objectKey } = egress.started[0]!;
    await candidate.agent.post(`/api/candidate/sessions/${candidate.sessionId}/complete`);
    storage.objects.set(objectKey, 10);
    await webhook(app, egressEvent('EV_d', egressId, 'COMPLETE', { filename: objectKey, sizeBytes: 10, durationSeconds: 1 }));
    const recordingId = (await recruiter.get(`/api/interviews/${id}/recordings`)).body.items[0].id;

    storage.failDelete = true;
    const failed = await recruiter.delete(`/api/recordings/${recordingId}`);
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('RECORDING_DELETE_FAILED');
    expect((await recruiter.get(`/api/interviews/${id}/recordings`)).body.items[0].status).toBe('READY');

    storage.failDelete = false;
    const deleted = await recruiter.delete(`/api/recordings/${recordingId}`);
    expect(deleted.body.status).toBe('DELETED');
    expect(storage.objects.has(objectKey)).toBe(false);
    expect((await recruiter.post(`/api/recordings/${recordingId}/playback-url`)).body.error.code).toBe('RECORDING_DELETED');
  });
});
