import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, candidateAgent, consentBody, createRecruiter, readyInterview, recruiterAgent, resetDb, startInterview, testDb } from './helpers.js';

async function setup(config: Record<string, unknown> = {}) {
  const t = buildTestApp();
  await createRecruiter();
  const recruiter = await recruiterAgent(t.app);
  const ready = await readyInterview(recruiter, config);
  return { ...t, recruiter, ...ready };
}

describe('candidate access (PRD §2.1)', () => {
  beforeEach(resetDb);

  it('rejects unknown codes and wrong access codes with the same error', async () => {
    const { app, invitation } = await setup();
    const unknown = await request(app).post('/api/candidate/access').send({ invitationCode: 'HB-NOPE-NOPE', accessCode: '123456' });
    const wrong = await request(app).post('/api/candidate/access').send({ invitationCode: invitation.code, accessCode: '000000' === invitation.accessCode ? '111111' : '000000' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.code).toBe('INVITATION_INVALID');
    expect(wrong.body.error.code).toBe('INVITATION_INVALID');
  });

  it('locks the invitation after 5 wrong access codes', async () => {
    const { app, invitation } = await setup();
    const bad = invitation.accessCode === '999999' ? '999998' : '999999';
    for (let i = 0; i < 4; i += 1) await request(app).post('/api/candidate/access').send({ invitationCode: invitation.code, accessCode: bad });
    const fifth = await request(app).post('/api/candidate/access').send({ invitationCode: invitation.code, accessCode: bad });
    expect(fifth.status).toBe(423);
    const correct = await request(app).post('/api/candidate/access').send({ invitationCode: invitation.code, accessCode: invitation.accessCode });
    expect(correct.body.error.code).toBe('SESSION_LOCKED');
  });

  it('rejects an expired invitation', async () => {
    const { app, invitation, id } = await setup();
    await testDb().invitation.update({ where: { interviewId: id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).post('/api/candidate/access').send({ invitationCode: invitation.code, accessCode: invitation.accessCode });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('INVITATION_EXPIRED');
  });

  it('issues a scoped session that only sees candidate-safe data', async () => {
    const { app, invitation, id } = await setup();
    const { agent, sessionId } = await candidateAgent(app, invitation);
    const view = await agent.get(`/api/candidate/sessions/${sessionId}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ interviewId: id, status: 'ONBOARDING', candidateName: 'Jamie', questionCount: 3, consent: null, pairing: null, secondaryCamera: 'OFF' });
    expect(view.body.recording.enabled).toBe(false);
    const raw = JSON.stringify(view.body);
    for (const secret of ['evaluationCriteria', 'expectedAnswerPoints', 'candidateEmail', 'accessCode', 'score']) expect(raw).not.toContain(secret);

    // Another session id (even a valid-looking one) is not this candidate's.
    expect((await agent.get('/api/candidate/sessions/00000000-0000-4000-8000-000000000000')).status).toBe(403);
    // Logout ends the session.
    await agent.post('/api/candidate/logout');
    expect((await agent.get(`/api/candidate/sessions/${sessionId}`)).body.error.code).toBe('SESSION_EXPIRED');
  });
});

describe('candidate interview flow (PRD §8.1)', () => {
  beforeEach(resetDb);

  it('requires consent before starting, and observation consent in particular', async () => {
    const { app, invitation } = await setup();
    const { agent, sessionId } = await candidateAgent(app, invitation);
    expect((await agent.post(`/api/candidate/sessions/${sessionId}/start`)).body.error.code).toBe('CONSENT_REQUIRED');
    const noProctoring = await agent.post(`/api/candidate/sessions/${sessionId}/consent`).send({ ...consentBody(false), proctoringConsent: false });
    expect(noProctoring.body.error.code).toBe('CONSENT_REQUIRED');
    const stale = await agent.post(`/api/candidate/sessions/${sessionId}/consent`).send({ ...consentBody(false), recordingNoticeVersion: 'old' });
    expect(stale.status).toBe(400);
  });

  it('persists answers, survives refresh, ignores retries and completes safely', async () => {
    const { app, invitation, recruiter, id } = await setup();
    const { agent, sessionId } = await candidateAgent(app, invitation);
    const first = await startInterview(agent, sessionId);
    expect(first).toMatchObject({ status: 'IN_PROGRESS', question: { sequence: 1 }, progress: { answered: 0, total: 3 } });
    expect(first.question).not.toHaveProperty('evaluationCriteria');

    const s = `/api/candidate/sessions/${sessionId}`;
    const answer = { questionId: first.question.id, transcript: 'Authentication proves identity; authorization checks permissions.', durationSeconds: 42, inputMode: 'VOICE', idempotencyKey: 'key-question-1' };
    const second = await agent.post(`${s}/answers`).send(answer);
    expect(second.body).toMatchObject({ question: { sequence: 2 }, progress: { answered: 1 } });

    // Network retry with the same key: same result, no duplicate row.
    const retry = await agent.post(`${s}/answers`).send(answer);
    expect(retry.status).toBe(200);
    expect(retry.body.progress.answered).toBe(1);
    expect(await testDb().answer.count()).toBe(1);

    // A different key for an already-answered question is a duplicate.
    expect((await agent.post(`${s}/answers`).send({ ...answer, idempotencyKey: 'key-question-1-b' })).body.error.code).toBe('DUPLICATE_SUBMISSION');
    // Empty answers are rejected rather than silently saved.
    expect((await agent.post(`${s}/answers`).send({ ...answer, questionId: second.body.question.id, transcript: '   ', idempotencyKey: 'key-empty-1' })).status).toBe(400);

    // Refresh: state comes from the backend.
    const refreshed = await agent.get(`${s}/current-question`);
    expect(refreshed.body.question.id).toBe(second.body.question.id);

    const skipped = await agent.post(`${s}/skip`).send({ questionId: second.body.question.id, idempotencyKey: 'key-skip-2' });
    expect(skipped.body.progress).toMatchObject({ answered: 1, skipped: 1, currentSequence: 3 });

    const done = await agent.post(`${s}/complete`);
    expect(done.body).toMatchObject({ status: 'COMPLETED', progress: { answered: 1, skipped: 1, total: 3 } });
    expect(await testDb().answer.count({ where: { status: 'UNANSWERED' } })).toBe(1);
    // Completing twice is harmless.
    expect((await agent.post(`${s}/complete`)).body.status).toBe('COMPLETED');
    // The invitation cannot be reused.
    expect((await request(app).post('/api/candidate/access').send(invitation)).status).toBe(400);
    const reuse = await request(app).post('/api/candidate/access').send({ invitationCode: invitation.code, accessCode: invitation.accessCode });
    expect(reuse.body.error.code).toBe('INTERVIEW_COMPLETED');

    // The recruiter report uses the persisted transcripts; unanswered is not a zero score.
    const report = await recruiter.get(`/api/interviews/${id}/report`);
    expect(report.body.items.map((i: { answer: { status: string } }) => i.answer.status)).toEqual(['ANSWERED', 'SKIPPED', 'UNANSWERED']);
    expect(report.body.items[0].answer.transcript).toContain('authorization');
    expect(report.body).toMatchObject({ evaluationStatus: 'NOT_STARTED', overall: null });
    const list = await recruiter.get('/api/interviews');
    expect(list.body.stats).toMatchObject({ completed: 1, pendingReview: 1 });
  });

  it('enforces skip policy and question order', async () => {
    const { app, invitation } = await setup({ allowSkip: false });
    const { agent, sessionId } = await candidateAgent(app, invitation);
    const first = await startInterview(agent, sessionId);
    const s = `/api/candidate/sessions/${sessionId}`;
    expect((await agent.post(`${s}/skip`).send({ questionId: first.question.id, idempotencyKey: 'skip-key-1' })).body.error.code).toBe('SKIP_NOT_ALLOWED');
    const other = await testDb().question.findFirstOrThrow({ where: { sequence: 3 } });
    const outOfOrder = await agent.post(`${s}/answers`).send({ questionId: other.id, transcript: 'x', durationSeconds: 1, inputMode: 'TEXT', idempotencyKey: 'order-key-1' });
    expect(outOfOrder.status).toBe(409);
  });

  it('submits automatically once the time limit and grace period have passed', async () => {
    const { app, invitation, clock } = await setup({ durationMinutes: 20 });
    const { agent, sessionId } = await candidateAgent(app, invitation);
    const first = await startInterview(agent, sessionId);
    clock.offsetMs = 23 * 60_000; // 20 min + 2 min grace + 1
    const late = await agent.post(`/api/candidate/sessions/${sessionId}/answers`).send({ questionId: first.question.id, transcript: 'late', durationSeconds: 5, inputMode: 'TEXT', idempotencyKey: 'late-key-1' });
    expect(late.status).toBe(409);
    const current = await agent.get(`/api/candidate/sessions/${sessionId}/current-question`);
    expect(current.body).toMatchObject({ status: 'COMPLETED', question: null });
  });
});
