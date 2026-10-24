import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildTestApp,
  candidateAgent,
  createRecruiter,
  JOB_DESCRIPTION,
  readyInterview,
  recruiterAgent,
  resetDb,
  startInterview,
  testDb,
  type TestAppOptions,
} from './helpers.js';

async function setup(opts: TestAppOptions = {}) {
  const t = buildTestApp(opts);
  await createRecruiter();
  const recruiter = await recruiterAgent(t.app);
  return { ...t, recruiter };
}

const draftBody = {
  jobTitle: 'Backend Engineer',
  jobDescription: JOB_DESCRIPTION,
  requiredSkills: ['Node.js', 'PostgreSQL'],
  candidateName: 'Sam Lee',
  candidateEmail: 'sam@example.test',
  config: { durationMinutes: 20, allowSkip: false },
};

describe('editing and deleting interviews (PRD §5.1 interview CRUD)', () => {
  beforeEach(resetDb);

  it('edits a draft without resetting fields or config that were not sent', async () => {
    const { recruiter } = await setup();
    const id = (await recruiter.post('/api/interviews').send(draftBody)).body.id;

    const res = await recruiter.patch(`/api/interviews/${id}`).send({ jobTitle: 'Senior Backend Engineer', config: { durationMinutes: 45 } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ jobTitle: 'Senior Backend Engineer', candidateName: 'Sam Lee', requiredSkills: ['Node.js', 'PostgreSQL'] });
    // Only durationMinutes changed; allowSkip keeps the recruiter's earlier choice instead of the default.
    expect(res.body.config).toMatchObject({ durationMinutes: 45, allowSkip: false, questionCount: 10 });

    const audit = await testDb().auditEvent.findFirstOrThrow({ where: { action: 'interview.updated' } });
    expect(audit.metadata).toEqual({ fields: 'jobTitle,config' });
  });

  it('validates edits like creation', async () => {
    const { recruiter } = await setup();
    const id = (await recruiter.post('/api/interviews').send(draftBody)).body.id;

    const empty = await recruiter.patch(`/api/interviews/${id}`).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error.message).toBe('Change at least one field.');
    expect((await recruiter.patch(`/api/interviews/${id}`)).status).toBe(400);
    expect((await recruiter.patch(`/api/interviews/${id}`).send({ candidateEmail: 'nope' })).body.error.details.fields).toHaveProperty('candidateEmail');
    expect((await recruiter.patch(`/api/interviews/${id}`).send({ config: { durationMinutes: 500 } })).status).toBe(400);
    const phone = await recruiter.patch(`/api/interviews/${id}`).send({ config: { secondaryCamera: 'REQUIRED' } });
    expect(phone.body.error.details.fields).toHaveProperty('secondaryCamera');
  });

  it('locks edits and deletion once the invitation is issued', async () => {
    const { recruiter } = await setup();
    const { id } = await readyInterview(recruiter);
    const edit = await recruiter.patch(`/api/interviews/${id}`).send({ jobTitle: 'Changed' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.message).toMatch(/locked/);
    const del = await recruiter.delete(`/api/interviews/${id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.message).toMatch(/Cancel this interview instead/);
  });

  it('deletes a draft and everything that belongs to it', async () => {
    const { recruiter } = await setup();
    const id = (await recruiter.post('/api/interviews').send(draftBody)).body.id;
    await recruiter.patch(`/api/interviews/${id}/questions`).send({
      questions: [{ text: 'Explain database indexes.', category: 'TECHNICAL', difficulty: 'EASY', source: 'RECRUITER' }],
    });
    expect((await recruiter.delete(`/api/interviews/${id}`)).status).toBe(204);
    expect((await recruiter.get(`/api/interviews/${id}`)).status).toBe(404);
    expect(await testDb().question.count()).toBe(0);
  });

  it('keeps other recruiters out of edit, delete and cancel', async () => {
    const { app, recruiter } = await setup();
    const id = (await recruiter.post('/api/interviews').send(draftBody)).body.id;
    await createRecruiter('other@example.test', 'Other');
    const other = await recruiterAgent(app, 'other@example.test');
    expect((await other.patch(`/api/interviews/${id}`).send({ jobTitle: 'Mine now' })).status).toBe(404);
    expect((await other.delete(`/api/interviews/${id}`)).status).toBe(404);
    expect((await other.post(`/api/interviews/${id}/cancel`)).status).toBe(404);
    expect((await request(app).post(`/api/interviews/${id}/cancel`)).status).toBe(401);
    expect((await recruiter.get(`/api/interviews/${id}`)).body.jobTitle).toBe('Backend Engineer');
  });
});

describe('cancelling interviews (PRD §8.1 CANCELLED state)', () => {
  beforeEach(resetDb);

  it('ends candidate access immediately and can be repeated safely', async () => {
    const { app, recruiter } = await setup();
    const { id, invitation } = await readyInterview(recruiter);
    const candidate = await candidateAgent(app, invitation);

    const res = await recruiter.post(`/api/interviews/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED', endedAt: null });

    const view = await candidate.agent.get(`/api/candidate/sessions/${candidate.sessionId}`);
    expect(view.status).toBe(401);
    expect(view.body.error.code).toBe('SESSION_EXPIRED');
    const again = await request(app).post('/api/candidate/access').send({ invitationCode: invitation.code, accessCode: invitation.accessCode });
    expect(again.body.error.code).toBe('INVITATION_EXPIRED');

    expect((await recruiter.post(`/api/interviews/${id}/cancel`)).body.status).toBe('CANCELLED');
    expect((await recruiter.patch(`/api/interviews/${id}`).send({ jobTitle: 'x' })).status).toBe(409);
    expect(await testDb().auditEvent.count({ where: { action: 'interview.cancelled' } })).toBe(1);
  });

  it('keeps answers saved before an in-progress interview is cancelled', async () => {
    const { app, recruiter } = await setup();
    const { id, invitation } = await readyInterview(recruiter);
    const { agent, sessionId } = await candidateAgent(app, invitation);
    const first = await startInterview(agent, sessionId);
    await agent.post(`/api/candidate/sessions/${sessionId}/answers`).send({
      questionId: first.question.id, transcript: 'Saved before cancelling.', durationSeconds: 10, inputMode: 'TEXT', idempotencyKey: 'cancel-key-1',
    });

    const res = await recruiter.post(`/api/interviews/${id}/cancel`);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.endedAt).not.toBeNull();

    const late = await agent.post(`/api/candidate/sessions/${sessionId}/answers`).send({
      questionId: first.question.id, transcript: 'too late', durationSeconds: 1, inputMode: 'TEXT', idempotencyKey: 'cancel-key-2',
    });
    expect(late.status).toBe(401);
    const report = await recruiter.get(`/api/interviews/${id}/report`);
    expect(report.body.items[0].answer).toMatchObject({ status: 'ANSWERED', transcript: 'Saved before cancelling.' });
  });

  it('stops an active recording when the interview is cancelled', async () => {
    const { app, recruiter, egress } = await setup({ recordingEnabled: true });
    const { id, invitation } = await readyInterview(recruiter, { recordingEnabled: true });
    const { agent, sessionId } = await candidateAgent(app, invitation);
    await startInterview(agent, sessionId, true);
    const { egressId } = egress.started[0]!;

    await recruiter.post(`/api/interviews/${id}/cancel`);
    expect(egress.stopped).toEqual([egressId]);
    expect((await recruiter.get(`/api/interviews/${id}/recordings`)).body.items[0].status).toBe('FINALIZING');
  });

  it('refuses to cancel a finished interview', async () => {
    const { app, recruiter } = await setup();
    const { id, invitation } = await readyInterview(recruiter);
    const { agent, sessionId } = await candidateAgent(app, invitation);
    await startInterview(agent, sessionId);
    await agent.post(`/api/candidate/sessions/${sessionId}/complete`);
    const res = await recruiter.post(`/api/interviews/${id}/cancel`);
    expect(res.status).toBe(409);
    expect((await recruiter.get(`/api/interviews/${id}`)).body.status).toBe('COMPLETED');
  });
});

describe('server-side time limit (PRD §8.1)', () => {
  beforeEach(resetDb);

  it('ends an overdue interview even if the candidate never comes back', async () => {
    const { app, recruiter, services, clock } = await setup();
    const { id, invitation } = await readyInterview(recruiter); // 20 minutes
    const { agent, sessionId } = await candidateAgent(app, invitation);
    const first = await startInterview(agent, sessionId);
    await agent.post(`/api/candidate/sessions/${sessionId}/answers`).send({
      questionId: first.question.id, transcript: 'An answer before leaving.', durationSeconds: 30, inputMode: 'TEXT', idempotencyKey: 'sweep-key-1',
    });

    clock.offsetMs = 21 * 60_000; // inside the 2-minute grace period
    expect(await services.candidateFlow.expireOverdue()).toBe(0);

    clock.offsetMs = 23 * 60_000;
    expect(await services.candidateFlow.expireOverdue()).toBe(1);
    expect(await services.candidateFlow.expireOverdue()).toBe(0);

    const report = await recruiter.get(`/api/interviews/${id}/report`);
    expect(report.body.interview.status).toBe('COMPLETED');
    expect(report.body.items.map((i: { answer: { status: string } }) => i.answer.status)).toEqual(['ANSWERED', 'UNANSWERED', 'UNANSWERED']);
    const audit = await testDb().auditEvent.findFirstOrThrow({ where: { action: 'interview.completed' } });
    expect(audit).toMatchObject({ actorRole: 'SYSTEM', metadata: { reason: 'time_limit' } });
  });
});

describe('review moves the interview through the state machine', () => {
  beforeEach(resetDb);

  it('marks the interview REVIEWED once every evaluation is reviewed, keeping the AI score', async () => {
    const { app, recruiter } = await setup();
    const { id, invitation } = await readyInterview(recruiter);
    const { agent, sessionId } = await candidateAgent(app, invitation);
    await startInterview(agent, sessionId);
    await agent.post(`/api/candidate/sessions/${sessionId}/complete`);

    // Workstream E writes evaluations; simulate its output for one question.
    const db = testDb();
    const question = await db.question.findFirstOrThrow({ where: { interviewId: id, sequence: 1 } });
    await db.interview.update({ where: { id }, data: { status: 'EVALUATED', evaluationStatus: 'EVALUATED' } });
    const evaluation = await db.evaluation.create({
      data: { interviewId: id, questionId: question.id, score: 6, criteria: [], evidence: [], explanation: 'Partial answer.', strengths: [], gaps: [] },
    });

    const tooHigh = await recruiter.patch(`/api/evaluations/${evaluation.id}/review`).send({ reviewStatus: 'OVERRIDDEN', score: 11, reason: 'x' });
    expect(tooHigh.status).toBe(400);
    const noReason = await recruiter.patch(`/api/evaluations/${evaluation.id}/review`).send({ reviewStatus: 'OVERRIDDEN', score: 8 });
    expect(noReason.status).toBe(400);

    const res = await recruiter.patch(`/api/evaluations/${evaluation.id}/review`).send({ reviewStatus: 'OVERRIDDEN', score: 8, reason: 'Covered retries well.' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ score: 6, reviewStatus: 'OVERRIDDEN', override: { score: 8, reason: 'Covered retries well.', reviewerName: 'Test Recruiter' } });
    expect((await recruiter.get(`/api/interviews/${id}`)).body).toMatchObject({ status: 'REVIEWED', overallScore: 8 });
  });
});
