import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, candidateAgent, createRecruiter, JOB_DESCRIPTION, QUESTIONS, readyInterview, recruiterAgent, resetDb, testDb } from './helpers.js';

describe('interview setup (PRD §7.2, §8.1)', () => {
  beforeEach(resetDb);

  it('validates the create form field by field', async () => {
    const { app } = buildTestApp();
    await createRecruiter();
    const agent = await recruiterAgent(app);
    const res = await agent.post('/api/interviews').send({ jobTitle: '', jobDescription: 'short', candidateName: 'A', candidateEmail: 'bad', config: {} });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details.fields)).toEqual(expect.arrayContaining(['jobTitle', 'jobDescription', 'candidateEmail']));
  });

  it('creates a DRAFT with the default of 10 questions when no count is given', async () => {
    const { app } = buildTestApp();
    await createRecruiter();
    const agent = await recruiterAgent(app);
    const res = await agent.post('/api/interviews').send({
      jobTitle: 'Backend Engineer',
      jobDescription: JOB_DESCRIPTION,
      candidateName: 'Sam',
      candidateEmail: 'sam@example.test',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'DRAFT', questionCount: 10, recordingStatus: 'NOT_ENABLED', invitation: null, live: null });
    expect(res.body.config).toMatchObject({ questionCount: 10, durationMinutes: 30, secondaryCamera: 'OPTIONAL' });
  });

  it('refuses to require a phone camera when LiveKit is not configured', async () => {
    const { app } = buildTestApp();
    await createRecruiter();
    const agent = await recruiterAgent(app);
    const res = await agent.post('/api/interviews').send({
      jobTitle: 'X', jobDescription: JOB_DESCRIPTION, candidateName: 'Sam', candidateEmail: 'sam@example.test', config: { secondaryCamera: 'REQUIRED' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields).toHaveProperty('secondaryCamera');
  });

  it('saves ordered questions, rejects duplicates, issues an invitation and then locks setup', async () => {
    const { app } = buildTestApp();
    await createRecruiter();
    const agent = await recruiterAgent(app);
    const created = await agent.post('/api/interviews').send({ jobTitle: 'X', jobDescription: JOB_DESCRIPTION, candidateName: 'Sam', candidateEmail: 'sam@example.test' });
    const id = created.body.id;

    const dup = await agent.patch(`/api/interviews/${id}/questions`).send({ questions: [QUESTIONS[0], { ...QUESTIONS[0], text: QUESTIONS[0].text.toUpperCase() }] });
    expect(dup.status).toBe(400);

    expect((await agent.post(`/api/interviews/${id}/ready`)).status).toBe(400); // no questions yet

    const saved = await agent.patch(`/api/interviews/${id}/questions`).send({ questions: QUESTIONS });
    expect(saved.status).toBe(200);
    expect(saved.body.questions.map((q: { sequence: number }) => q.sequence)).toEqual([1, 2, 3]);

    // Reorder: ids are kept stable.
    const reordered = await agent.patch(`/api/interviews/${id}/questions`).send({
      questions: [saved.body.questions[2], saved.body.questions[0], saved.body.questions[1]],
    });
    expect(reordered.body.questions[0].id).toBe(saved.body.questions[2].id);
    expect(reordered.body.questions[0].sequence).toBe(1);

    const ready = await agent.post(`/api/interviews/${id}/ready`);
    expect(ready.status).toBe(200);
    expect(ready.body.interview.status).toBe('READY');
    expect(ready.body.invitation.code).toMatch(/^HB-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(ready.body.invitation.accessCode).toMatch(/^\d{6}$/);
    expect(ready.body.invitation.url).toBe(`http://localhost:5173/candidate/login?code=${ready.body.invitation.code}`);

    // Idempotent: the same invitation comes back.
    const again = await agent.post(`/api/interviews/${id}/ready`);
    expect(again.body.invitation).toEqual(ready.body.invitation);

    // The access code is never stored in plain text.
    const row = await testDb().invitation.findUniqueOrThrow({ where: { interviewId: id } });
    expect(JSON.stringify(row)).not.toContain(ready.body.invitation.accessCode);

    expect((await agent.patch(`/api/interviews/${id}/questions`).send({ questions: QUESTIONS })).status).toBe(409);
  });

  it('lists only the recruiter’s own interviews with stats and search', async () => {
    const { app } = buildTestApp();
    await createRecruiter('a@example.test', 'Alice');
    await createRecruiter('b@example.test', 'Bob');
    const alice = await recruiterAgent(app, 'a@example.test');
    const bob = await recruiterAgent(app, 'b@example.test');
    const { id } = await readyInterview(alice);
    await alice.post('/api/interviews').send({ jobTitle: 'Data Analyst', jobDescription: JOB_DESCRIPTION, candidateName: 'Riya', candidateEmail: 'riya@example.test' });

    const list = await alice.get('/api/interviews');
    expect(list.body.stats).toEqual({ total: 2, inProgress: 0, completed: 0, pendingReview: 0 });
    expect((await alice.get('/api/interviews?search=analyst')).body.items).toHaveLength(1);
    expect((await alice.get('/api/interviews?status=READY')).body.items[0].id).toBe(id);

    expect((await bob.get('/api/interviews')).body.items).toHaveLength(0);
    expect((await bob.get(`/api/interviews/${id}`)).status).toBe(404);
    expect((await bob.get(`/api/interviews/${id}/report`)).status).toBe(404);
    expect((await bob.post(`/api/interviews/${id}/ready`)).status).toBe(404);
  });

  it('answers honestly for workstream E features that are not set up', async () => {
    const { app } = buildTestApp();
    await createRecruiter();
    const agent = await recruiterAgent(app);
    const { id } = await readyInterview(agent);
    const gen = await agent.post(`/api/interviews/${id}/questions/generate`).send({ count: 5 });
    expect(gen.status).toBe(503);
    expect(gen.body.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect((await agent.post(`/api/interviews/${id}/evaluate`)).body.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('keeps candidates out of recruiter APIs and recruiters out of other sessions', async () => {
    const { app } = buildTestApp();
    await createRecruiter();
    const recruiter = await recruiterAgent(app);
    const { id, invitation } = await readyInterview(recruiter);
    const { agent: candidate, sessionId } = await candidateAgent(app, invitation);

    expect((await candidate.get('/api/interviews')).status).toBe(401);
    expect((await candidate.get(`/api/interviews/${id}/report`)).status).toBe(401);
    expect((await recruiter.get(`/api/candidate/sessions/${sessionId}`)).status).toBe(401);
    expect((await request(app).get('/api/interviews/not-a-uuid')).status).toBe(401);
    expect((await recruiter.get('/api/interviews/not-a-uuid')).status).toBe(404);
  });
});
