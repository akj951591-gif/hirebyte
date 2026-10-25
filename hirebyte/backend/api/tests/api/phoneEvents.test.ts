import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, candidateAgent, createRecruiter, readyInterview, recruiterAgent, resetDb, startInterview, testDb } from './helpers.js';

describe('phone camera observations (PRD §9.1, §13)', () => {
  beforeEach(resetDb);

  it('records observations from the paired phone as the SECONDARY camera, only while the interview runs', async () => {
    const t = buildTestApp({ media: true });
    await createRecruiter();
    const recruiter = await recruiterAgent(t.app);
    const { id, invitation } = await readyInterview(recruiter);
    const candidate = await candidateAgent(t.app, invitation);
    const view = await candidate.agent.get(`/api/candidate/sessions/${candidate.sessionId}`);
    const pairingToken = new URL(view.body.pairing.url).searchParams.get('token')!;
    const { deviceToken } = (await request(t.app).post(`/api/interviews/${id}/media-token`).send({ device: 'secondary', pairingToken })).body;

    const observe = (body: Record<string, unknown>) => request(t.app).post(`/api/interviews/${id}/phone-events`).send(body);
    const observation = { type: 'MULTIPLE_FACES', durationSeconds: 2.5, description: 'More than one person seen on the phone camera for 2.5s.' };

    // Before the interview starts (device check), observations are refused.
    expect((await observe({ ...observation, deviceToken })).status).toBe(409);
    await startInterview(candidate.agent, candidate.sessionId);

    // The phone cannot pretend to be the laptop camera.
    const res = await observe({ ...observation, sourceCamera: 'PRIMARY', deviceToken });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'MULTIPLE_FACES', sourceCamera: 'SECONDARY', reviewStatus: 'UNREVIEWED' });
    expect(t.events.of('proctoring.event_created').at(-1)).toMatchObject({ interviewId: id, sourceCamera: 'SECONDARY' });

    expect((await observe({ ...observation, deviceToken: 'x'.repeat(40) })).status).toBe(401);
    expect((await observe(observation)).status).toBe(400);
    expect(await testDb().proctoringEvent.count({ where: { interviewId: id, sourceCamera: 'SECONDARY', type: 'MULTIPLE_FACES' } })).toBe(1);

    const report = await recruiter.get(`/api/interviews/${id}/report`);
    expect(report.body.proctoringEvents.map((e: { description: string }) => e.description)).toContain(observation.description);
  });
});
