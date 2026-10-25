import { beforeEach, describe, expect, it } from 'vitest';
import { LlmError } from './fakes.js';
import { buildTestApp, candidateAgent, createRecruiter, readyInterview, recruiterAgent, resetDb, startInterview, testDb, type TestAppOptions } from './helpers.js';

/** Greeting, candidate questions to the interviewer, and the closing line (the AI conversation). */
async function setup(opts: TestAppOptions = { ai: true }, config: Record<string, unknown> = {}) {
  const t = buildTestApp(opts);
  await createRecruiter();
  const recruiter = await recruiterAgent(t.app);
  const ready = await readyInterview(recruiter, config);
  const { agent, sessionId } = await candidateAgent(t.app, ready.invitation);
  const first = await startInterview(agent, sessionId);
  const s = `/api/candidate/sessions/${sessionId}`;
  return { ...t, recruiter, ...ready, agent, sessionId, first, s };
}

describe('AI interviewer conversation flow', () => {
  beforeEach(resetDb);

  it('greets the candidate, and repeats the right line after a refresh', async () => {
    const t = await setup({ ai: true }, { allowFollowUps: true, maxFollowUps: 1 });
    expect(t.first.interviewerReply).toBe(
      'Hello Jamie, and welcome to your Software Engineer interview with HireByte. I\'ll ask you 3 questions, and I may ask a short follow-up now and then. ' +
        'Take your time and answer in your own words. If a question is unclear, you can ask me about it. Let\'s begin.',
    );
    expect((await t.agent.get(`${t.s}/current-question`)).body.interviewerReply).toBe(t.first.interviewerReply);

    t.llm.nextTurns = [{ reply: 'Thanks, that is clear.', followUp: '' as unknown as null }];
    await t.agent.post(`${t.s}/answers`).send({ questionId: t.first.question.id, transcript: 'My answer.', durationSeconds: 5, inputMode: 'VOICE', idempotencyKey: 'flow-key-1' });
    const refreshed = (await t.agent.get(`${t.s}/current-question`)).body;
    expect(refreshed).toMatchObject({ question: { sequence: 2 }, interviewerReply: 'Thanks, that is clear.' });
  });

  it('lets the candidate ask about the current question, within a limit', async () => {
    const t = await setup();
    const ask = (message: string, questionId = t.first.question.id) => t.agent.post(`${t.s}/ask`).send({ questionId, message });

    const res = await ask('Could you rephrase that question?');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      question: { role: 'CANDIDATE', kind: 'CLARIFICATION_REQUEST', text: 'Could you rephrase that question?', questionId: t.first.question.id },
      reply: { role: 'INTERVIEWER', kind: 'CLARIFICATION', text: expect.stringContaining(t.first.question.text) },
    });
    expect(t.llm.clarificationRequests[0]).toMatchObject({ message: 'Could you rephrase that question?', question: { text: t.first.question.text } });

    // A failed attempt is not counted against the limit.
    t.llm.turnFails = true;
    expect((await ask('What does that mean?')).status).toBe(504);
    t.llm.turnFails = false;
    expect((await ask('What does authorization mean?')).status).toBe(200);
    expect((await ask('And authentication?')).status).toBe(200);
    const fourth = await ask('One more?');
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.message).toMatch(/up to 3 questions/);

    expect((await ask('x')).status).toBe(400);
    expect((await ask('About another question?', '00000000-0000-4000-8000-000000000000')).status).toBe(409);
    const turns = (await t.agent.get(`${t.s}/conversation`)).body.turns;
    expect(turns.map((x: { kind: string }) => x.kind)).toEqual(['GREETING', ...Array(3).fill(['CLARIFICATION_REQUEST', 'CLARIFICATION']).flat()]);
  });

  it('answers honestly when the AI is not set up', async () => {
    const t = await setup({});
    expect(t.first.interviewerReply).toMatch(/^Hello Jamie/); // the greeting needs no AI
    const res = await t.agent.post(`${t.s}/ask`).send({ questionId: t.first.question.id, message: 'Can you repeat that?' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('closes with a thank-you and gives the recruiter the whole conversation in order', async () => {
    const t = await setup();
    t.llm.nextTurns = [{ reply: 'Thank you for that.', followUp: null }];
    await t.agent.post(`${t.s}/ask`).send({ questionId: t.first.question.id, message: 'Do you mean in a web app?' });
    await t.agent.post(`${t.s}/answers`).send({ questionId: t.first.question.id, transcript: 'Yes, in a web app.', durationSeconds: 5, inputMode: 'TEXT', idempotencyKey: 'flow-close-1' });
    const done = await t.agent.post(`${t.s}/complete`);
    expect(done.body.closingMessage).toBe('Thank you, Jamie. That\'s the end of the interview. Your answers have been saved, and the hiring team will review them and get back to you.');
    // Completing again returns the same closing line without adding another.
    expect((await t.agent.post(`${t.s}/complete`)).body.closingMessage).toBe(done.body.closingMessage);
    expect(await testDb().conversationTurn.count({ where: { interviewId: t.id, kind: 'CLOSING' } })).toBe(1);

    const report = await t.recruiter.get(`/api/interviews/${t.id}/report`);
    expect(report.body.conversation.map((x: { role: string; kind: string }) => `${x.role}:${x.kind}`)).toEqual([
      'INTERVIEWER:GREETING',
      'CANDIDATE:CLARIFICATION_REQUEST',
      'INTERVIEWER:CLARIFICATION',
      'INTERVIEWER:REPLY',
      'INTERVIEWER:CLOSING',
    ]);
  });

  it('closes the conversation when the time limit ends the interview too', async () => {
    const t = await setup();
    t.clock.offsetMs = 23 * 60_000;
    expect(await t.services.candidateFlow.expireOverdue()).toBe(1);
    expect(await testDb().conversationTurn.count({ where: { interviewId: t.id, kind: 'CLOSING' } })).toBe(1);
  });
});

export { LlmError };
