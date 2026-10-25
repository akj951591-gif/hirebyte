import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, candidateAgent, createRecruiter, readyInterview, recruiterAgent, resetDb, startInterview, testDb, type TestAppOptions } from './helpers.js';

/** The AI interviewer talks back between questions and may ask follow-ups (PRD §8.1 follow-up limits). */
async function setup(opts: TestAppOptions = { ai: true }, config: Record<string, unknown> = {}) {
  const t = buildTestApp(opts);
  await createRecruiter();
  const recruiter = await recruiterAgent(t.app);
  const ready = await readyInterview(recruiter, config);
  const { agent, sessionId } = await candidateAgent(t.app, ready.invitation);
  const first = await startInterview(agent, sessionId);
  let n = 0;
  const answer = (questionId: string, transcript = 'I would use an idempotency key stored with a unique constraint.') =>
    agent.post(`/api/candidate/sessions/${sessionId}/answers`).send({ questionId, transcript, durationSeconds: 20, inputMode: 'VOICE', idempotencyKey: `conv-key-${(n += 1)}` });
  return { ...t, recruiter, ...ready, agent, sessionId, first, answer };
}

describe('AI interviewer conversation', () => {
  beforeEach(resetDb);

  it('replies to each answer, and asks a follow-up right after it within the limit', async () => {
    const t = await setup({ ai: true }, { allowFollowUps: true, maxFollowUps: 1 });
    expect(t.first).toMatchObject({ interviewerReply: expect.stringContaining('Hello Jamie'), question: { sequence: 1, isFollowUp: false } });
    t.llm.nextTurns = [
      { reply: 'Thanks for walking me through that.', followUp: 'How would you expire old idempotency keys?' },
      { reply: 'Understood.', followUp: 'And what happens if two requests race?' },
    ];

    const afterFirst = await t.answer(t.first.question.id);
    expect(afterFirst.status).toBe(200);
    expect(afterFirst.body).toMatchObject({
      interviewerReply: 'Thanks for walking me through that.',
      question: { sequence: 2, text: 'How would you expire old idempotency keys?', isFollowUp: true },
      progress: { answered: 1, total: 4 },
    });
    expect(t.llm.turnRequests[0]).toMatchObject({ mayAskFollowUp: true, transcript: 'I would use an idempotency key stored with a unique constraint.' });

    // The follow-up limit (1 per original question) is reached: only a reply, no second follow-up.
    const afterFollowUp = await t.answer(afterFirst.body.question.id, 'Expire them after a day with a cleanup job.');
    expect(t.llm.turnRequests[1]).toMatchObject({ mayAskFollowUp: false });
    expect(afterFollowUp.body).toMatchObject({ interviewerReply: 'Understood.', question: { sequence: 3, isFollowUp: false }, progress: { total: 4 } });

    // Order and links are stored: the follow-up sits right after its original, later questions moved down.
    const questions = await testDb().question.findMany({ where: { interviewId: t.id }, orderBy: { sequence: 'asc' } });
    expect(questions.map((q) => [q.sequence, q.source])).toEqual([
      [1, 'RECRUITER'],
      [2, 'FOLLOW_UP'],
      [3, 'RECRUITER'],
      [4, 'RECRUITER'],
    ]);
    expect(questions[1]!.parentQuestionId).toBe(questions[0]!.id);
    expect(t.events.of('interview.question_changed').map((e) => e.sequence)).toEqual([1, 2, 3]);

    // The recruiter's report shows the follow-up and its answer in order.
    const report = await t.recruiter.get(`/api/interviews/${t.id}/report`);
    expect(report.body.items[1]).toMatchObject({ question: { source: 'FOLLOW_UP' }, answer: { transcript: 'Expire them after a day with a cleanup job.' } });
  });

  it('never asks follow-ups when the interview does not allow them', async () => {
    const t = await setup({ ai: true }, { allowFollowUps: false });
    t.llm.nextTurns = [{ reply: 'Thank you.', followUp: 'A follow-up that must be ignored?' }];
    const res = await t.answer(t.first.question.id);
    expect(t.llm.turnRequests[0]!.mayAskFollowUp).toBe(false);
    expect(res.body).toMatchObject({ interviewerReply: 'Thank you.', question: { sequence: 2, isFollowUp: false }, progress: { total: 3 } });
  });

  it('carries on without a reply when the AI is slow, failing or not configured', async () => {
    const slow = await setup({ ai: true }, { allowFollowUps: true, maxFollowUps: 2 });
    slow.llm.turnFails = true;
    const res = await slow.answer(slow.first.question.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ interviewerReply: null, question: { sequence: 2 } });

    await resetDb();
    const plain = await setup({}, { allowFollowUps: true, maxFollowUps: 2 });
    const res2 = await plain.answer(plain.first.question.id);
    expect(res2.body).toMatchObject({ interviewerReply: null, question: { sequence: 2 } });
  });

  it('does not reply to skips, and a retried answer is not replied to twice', async () => {
    const t = await setup({ ai: true }, { allowFollowUps: true, maxFollowUps: 1 });
    const body = { questionId: t.first.question.id, transcript: 'An answer.', durationSeconds: 5, inputMode: 'TEXT', idempotencyKey: 'conv-retry-1' };
    await t.agent.post(`/api/candidate/sessions/${t.sessionId}/answers`).send(body);
    const retry = await t.agent.post(`/api/candidate/sessions/${t.sessionId}/answers`).send(body);
    // The retry gets the stored reply back (like a refresh) without asking the AI again.
    expect(retry.body.interviewerReply).toBe('Thank you, that is clear.');
    expect(t.llm.turnRequests).toHaveLength(1);

    const skip = await t.agent.post(`/api/candidate/sessions/${t.sessionId}/skip`).send({ questionId: retry.body.question.id, idempotencyKey: 'conv-skip-1' });
    expect(skip.body.interviewerReply).toBeNull();
    expect(t.llm.turnRequests).toHaveLength(1);
  });
});
