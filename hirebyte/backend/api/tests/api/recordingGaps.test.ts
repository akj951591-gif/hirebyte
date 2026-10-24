import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { VALID_SIGNATURE } from './fakes.js';
import { buildTestApp, candidateAgent, createRecruiter, readyInterview, recruiterAgent, resetDb, startInterview, testDb, type TestAppOptions } from './helpers.js';

/** Part D checks added after the PRD §4.1 / §9 review: phone rejoin, consent feeds, retry, retention, reconcile. */

async function setup(opts: TestAppOptions = {}, config: Record<string, unknown> = {}) {
  const t = buildTestApp(opts);
  await createRecruiter();
  const recruiter = await recruiterAgent(t.app);
  const ready = await readyInterview(recruiter, config);
  const candidate = await candidateAgent(t.app, ready.invitation);
  return { ...t, recruiter, ...ready, candidate };
}
type Setup = Awaited<ReturnType<typeof setup>>;

function webhook(app: Setup['app'], body: Record<string, unknown>) {
  return request(app)
    .post('/api/webhooks/livekit/egress')
    .set('Authorization', VALID_SIGNATURE)
    .set('Content-Type', 'application/webhook+json')
    .send(JSON.stringify({ createdAt: new Date().toISOString(), ...body }));
}

const egress = (id: string, egressId: string, state: 'ACTIVE' | 'COMPLETE' | 'FAILED', file: Record<string, unknown> | null = null) => ({
  id,
  event: state === 'ACTIVE' ? 'egress_started' : 'egress_ended',
  egress: { egressId, roomName: 'ignored', state, error: state === 'FAILED' ? 'upload failed' : null, file },
});

/** Starts and completes an interview whose recording LiveKit then finishes into R2 (READY). */
async function readyRecording(t: Setup) {
  await startInterview(t.candidate.agent, t.candidate.sessionId, true);
  const { egressId, objectKey } = t.egress.started[0]!;
  await t.candidate.agent.post(`/api/candidate/sessions/${t.candidate.sessionId}/complete`);
  t.storage.objects.set(objectKey, 2048);
  await webhook(t.app, egress('EV_ready', egressId, 'COMPLETE', { filename: objectKey, sizeBytes: 2048, durationSeconds: 60 }));
  const rec = await testDb().recording.findFirstOrThrow({ where: { interviewId: t.id } });
  expect(rec.status).toBe('READY');
  return { rec, objectKey };
}

describe('phone reconnection (PRD §9.1)', () => {
  beforeEach(resetDb);

  it('lets the paired phone rejoin after a reload, and only the most recently paired phone', async () => {
    const { app, id, candidate } = await setup({ media: true });
    const qrToken = async () => {
      const view = await candidate.agent.get(`/api/candidate/sessions/${candidate.sessionId}`);
      return new URL(view.body.pairing.url).searchParams.get('token')!;
    };
    const phone = (body: Record<string, string>, interviewId = id) =>
      request(app).post(`/api/interviews/${interviewId}/media-token`).send({ device: 'secondary', ...body });

    const first = await phone({ pairingToken: await qrToken() });
    expect(first.status).toBe(200);
    expect(first.body.deviceToken).toEqual(expect.any(String));
    // After a reload the device token keeps working; it is not handed out again.
    const again = await phone({ deviceToken: first.body.deviceToken });
    expect(again.status).toBe(200);
    expect(again.body.deviceToken).toBeUndefined();
    expect((await phone({ deviceToken: first.body.deviceToken })).status).toBe(200);
    expect((await phone({})).status).toBe(400);
    expect((await phone({ deviceToken: first.body.deviceToken }, '00000000-0000-4000-8000-000000000000')).status).toBe(401);

    // The phone drops out, the laptop shows a new QR, and a second phone takes over.
    await webhook(app, { id: 'EV_gone', event: 'participant_left', participant: { identity: `candidate-secondary:${id}` } });
    const second = await phone({ pairingToken: await qrToken() });
    expect(second.status).toBe(200);
    expect((await phone({ deviceToken: first.body.deviceToken })).status).toBe(401);
    expect((await phone({ deviceToken: second.body.deviceToken })).status).toBe(200);

    const row = await testDb().mediaSession.findUniqueOrThrow({ where: { interviewId: id } });
    expect(row.phoneDeviceTokenHash).not.toBe(second.body.deviceToken);
    // Once the interview is over the phone cannot rejoin.
    await startInterview(candidate.agent, candidate.sessionId);
    await candidate.agent.post(`/api/candidate/sessions/${candidate.sessionId}/complete`);
    expect((await phone({ deviceToken: second.body.deviceToken })).status).toBe(409);
  });
});

describe('recording consent, retry and failures (PRD §4.1, §9.2, §9.4)', () => {
  beforeEach(resetDb);

  it('records which feeds the candidate agreed to have recorded', async () => {
    const yes = await setup({ recordingEnabled: true }, { recordingEnabled: true });
    await startInterview(yes.candidate.agent, yes.candidate.sessionId, true);
    expect((await testDb().consentRecord.findFirstOrThrow()).recordedFeeds).toEqual([
      'Laptop camera video',
      'Microphone audio',
      'Phone camera video (if connected)',
    ]);

    await resetDb();
    const no = await setup({ recordingEnabled: true }, { recordingEnabled: true });
    await startInterview(no.candidate.agent, no.candidate.sessionId, false);
    expect((await testDb().consentRecord.findFirstOrThrow()).recordedFeeds).toEqual([]);
  });

  it('lets the recruiter retry a failed recording, without ever starting two', async () => {
    const t = await setup({ recordingEnabled: true }, { recordingEnabled: true });
    t.egress.failStart = true;
    await startInterview(t.candidate.agent, t.candidate.sessionId, true);
    t.egress.failStart = false;

    const retry = await t.recruiter.post(`/api/interviews/${t.id}/recordings/start`);
    expect(retry.status).toBe(200);
    expect(retry.body.items.map((r: { status: string }) => r.status)).toEqual(['PENDING', 'FAILED']);
    expect(t.egress.started).toHaveLength(1);
    await t.recruiter.post(`/api/interviews/${t.id}/recordings/start`);
    expect(t.egress.started).toHaveLength(1);

    await t.candidate.agent.post(`/api/candidate/sessions/${t.candidate.sessionId}/complete`);
    expect((await t.recruiter.post(`/api/interviews/${t.id}/recordings/start`)).status).toBe(409);
  });

  it('refuses a retry without consent or when recording is off on the server', async () => {
    const declined = await setup({ recordingEnabled: true }, { recordingEnabled: true });
    await startInterview(declined.candidate.agent, declined.candidate.sessionId, false);
    expect((await declined.recruiter.post(`/api/interviews/${declined.id}/recordings/start`)).body.error.code).toBe('CONSENT_REQUIRED');
    expect(declined.egress.started).toHaveLength(0);

    await resetDb();
    const off = await setup({ media: true }, { recordingEnabled: true });
    await startInterview(off.candidate.agent, off.candidate.sessionId, true);
    expect((await off.recruiter.post(`/api/interviews/${off.id}/recordings/start`)).body.error.code).toBe('RECORDING_UNAVAILABLE');
  });

  it('shows an egress failure reported by webhook, and a late completion cannot revive it', async () => {
    const t = await setup({ recordingEnabled: true }, { recordingEnabled: true });
    await startInterview(t.candidate.agent, t.candidate.sessionId, true);
    const { egressId, objectKey } = t.egress.started[0]!;
    await webhook(t.app, egress('EV_fail', egressId, 'FAILED'));
    const rec = (await t.recruiter.get(`/api/interviews/${t.id}/recordings`)).body.items[0];
    expect(rec).toMatchObject({ status: 'FAILED', failureCode: 'EGRESS_FAILED' });
    expect((await t.recruiter.post(`/api/recordings/${rec.id}/playback-url`)).body.error.code).toBe('RECORDING_NOT_READY');

    t.storage.objects.set(objectKey, 10);
    await webhook(t.app, egress('EV_late', egressId, 'COMPLETE', { filename: objectKey, sizeBytes: 10, durationSeconds: 1 }));
    expect((await t.recruiter.get(`/api/interviews/${t.id}/recordings`)).body.items[0].status).toBe('FAILED');
  });
});

describe('recording retention and background reconcile (PRD §9.2)', () => {
  beforeEach(resetDb);

  it('issues a fresh short-lived URL on each request, so an expired link is simply requested again', async () => {
    const t = await setup({ recordingEnabled: true }, { recordingEnabled: true });
    const { rec } = await readyRecording(t);
    expect((await t.recruiter.post(`/api/recordings/${rec.id}/playback-url`)).status).toBe(200);
    expect((await t.recruiter.post(`/api/recordings/${rec.id}/playback-url`)).status).toBe(200);
    expect(t.storage.signed).toHaveLength(2);
  });

  it('deletes recordings when retention ends, and surfaces R2 failures instead of marking them deleted', async () => {
    const t = await setup({ recordingEnabled: true }, { recordingEnabled: true }); // RECORDING_RETENTION_DAYS=30 in tests
    const { rec, objectKey } = await readyRecording(t);
    expect(rec.retentionExpiresAt).not.toBeNull();
    expect(await t.services.recordings.deleteExpired()).toEqual({ deleted: 0, failed: 0 });

    t.clock.offsetMs = 31 * 86_400_000;
    t.storage.failDelete = true;
    expect(await t.services.recordings.deleteExpired()).toEqual({ deleted: 0, failed: 1 });
    expect((await testDb().recording.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe('READY');
    expect(await testDb().auditEvent.count({ where: { action: 'recording.retention_delete_failed' } })).toBe(1);

    t.storage.failDelete = false;
    expect(await t.services.recordings.deleteExpired()).toEqual({ deleted: 1, failed: 0 });
    expect(t.storage.objects.has(objectKey)).toBe(false);
    expect(await testDb().recording.findUniqueOrThrow({ where: { id: rec.id } })).toMatchObject({ status: 'DELETED', deletedAt: expect.any(Date) });
    expect(t.events.of('recording.status_changed').at(-1)).toMatchObject({ recordingId: rec.id, status: 'DELETED' });
  });

  it('keeps status in step with LiveKit in the background when no webhook arrives', async () => {
    const t = await setup({ recordingEnabled: true }, { recordingEnabled: true });
    await startInterview(t.candidate.agent, t.candidate.sessionId, true);
    const { egressId, objectKey } = t.egress.started[0]!;
    await t.candidate.agent.post(`/api/candidate/sessions/${t.candidate.sessionId}/complete`);
    t.egress.states.set(egressId, { egressId, state: 'COMPLETE', error: null, file: { filename: objectKey, sizeBytes: 512, durationSeconds: 9 } });
    t.storage.objects.set(objectKey, 512);

    t.clock.offsetMs = 20_000;
    expect(await t.services.recordings.reconcileActive()).toBe(1);
    expect((await testDb().recording.findFirstOrThrow({ where: { interviewId: t.id } })).status).toBe('READY');
    expect(await t.services.recordings.reconcileActive()).toBe(0);
  });
});
