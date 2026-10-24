import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { QuestionCategory } from '@contracts';
import type { GeneratedQuestion } from '../../src/providers/llm/llm.types.js';
import { LlmError } from './fakes.js';
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

async function setup(opts: TestAppOptions = { ai: true }) {
  const t = buildTestApp(opts);
  await createRecruiter();
  const recruiter = await recruiterAgent(t.app);
  const draft = await recruiter.post('/api/interviews').send({
    jobTitle: 'Backend Engineer',
    jobDescription: JOB_DESCRIPTION,
    requiredSkills: ['Node.js', 'PostgreSQL'],
    candidateName: 'Sam Lee',
    candidateEmail: 'sam@example.test',
    config: { categories: ['TECHNICAL', 'RESUME'] },
  });
  return { ...t, recruiter, draftId: draft.body.id as string };
}

const pdfBytes = Buffer.from('%PDF-1.7 fake test bytes');

const q = (text: string, category: QuestionCategory = 'TECHNICAL'): GeneratedQuestion => ({
  text,
  category,
  difficulty: 'MEDIUM',
  targetSkills: [],
  evaluationCriteria: ['c'],
  expectedAnswerPoints: ['p'],
});

/** Completes an interview with one answered, one skipped and one unanswered question. */
async function completedInterview(t: Awaited<ReturnType<typeof setup>>) {
  const { id, invitation } = await readyInterview(t.recruiter);
  const { agent, sessionId } = await candidateAgent(t.app, invitation);
  const first = await startInterview(agent, sessionId);
  const s = `/api/candidate/sessions/${sessionId}`;
  const transcript = 'Authentication proves who you are while authorization decides what you may do.';
  const second = await agent.post(`${s}/answers`).send({ questionId: first.question.id, transcript, durationSeconds: 30, inputMode: 'VOICE', idempotencyKey: 'ai-key-1' });
  await agent.post(`${s}/skip`).send({ questionId: second.body.question.id, idempotencyKey: 'ai-key-2' });
  await agent.post(`${s}/complete`);
  return { id, transcript };
}

describe('resume upload via the document service (PRD §7.2, §14)', () => {
  beforeEach(resetDb);

  it('stores only the extracted text and reports COMPLETED', async () => {
    const t = await setup();
    const res = await t.recruiter.post(`/api/interviews/${t.draftId}/resume`).attach('resume', pdfBytes, 'C:\\Users\\sam\\Sam Resume.pdf');
    expect(res.status).toBe(200);
    expect(res.body.resume).toMatchObject({ filename: 'Sam Resume.pdf', mimeType: 'application/pdf', sizeBytes: pdfBytes.length, extractionStatus: 'COMPLETED', failureCode: null });
    const row = await testDb().resume.findUniqueOrThrow({ where: { interviewId: t.draftId } });
    expect(row).toMatchObject({ extractedText: t.documents.text, storageKey: null });
    expect((await t.recruiter.get(`/api/interviews/${t.draftId}`)).body.resume.extractionStatus).toBe('COMPLETED');
  });

  it('refuses unsupported, oversized and missing files before calling the service', async () => {
    const t = await setup();
    const txt = await t.recruiter.post(`/api/interviews/${t.draftId}/resume`).attach('resume', Buffer.from('hello'), 'resume.txt');
    expect(txt.status).toBe(415);
    expect(txt.body.error.code).toBe('RESUME_UNSUPPORTED');
    const big = await t.recruiter.post(`/api/interviews/${t.draftId}/resume`).attach('resume', Buffer.alloc(5 * 1024 * 1024 + 1), 'big.pdf');
    expect(big.status).toBe(413);
    expect((await t.recruiter.post(`/api/interviews/${t.draftId}/resume`).field('note', 'x')).status).toBe(400);
    expect(t.documents.calls).toHaveLength(0);
  });

  it('records why an unreadable document failed', async () => {
    const t = await setup();
    t.documents.reject = { code: 'PASSWORD_PROTECTED', message: 'This PDF is password-protected.' };
    const res = await t.recruiter.post(`/api/interviews/${t.draftId}/resume`).attach('resume', pdfBytes, 'locked.pdf');
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'RESUME_UNREADABLE', message: 'This PDF is password-protected.', details: { failureCode: 'PASSWORD_PROTECTED' } });
    expect((await t.recruiter.get(`/api/interviews/${t.draftId}`)).body.resume).toMatchObject({ extractionStatus: 'FAILED', failureCode: 'PASSWORD_PROTECTED' });
  });

  it('separates "service down" from "bad document", and "not set up" from both', async () => {
    const t = await setup();
    t.documents.unavailable = true;
    const down = await t.recruiter.post(`/api/interviews/${t.draftId}/resume`).attach('resume', pdfBytes, 'resume.pdf');
    expect(down.status).toBe(503);
    expect(down.body.error.code).toBe('SERVICE_UNAVAILABLE');

    await resetDb();
    const plain = await setup({});
    const missing = await plain.recruiter.post(`/api/interviews/${plain.draftId}/resume`).attach('resume', pdfBytes, 'resume.pdf');
    expect(missing.status).toBe(503);
    expect(missing.body.error.message).toMatch(/not set up/);
  });

  it('only accepts uploads for the owner’s draft interviews', async () => {
    const t = await setup();
    await createRecruiter('other@example.test', 'Other');
    const other = await recruiterAgent(t.app, 'other@example.test');
    expect((await other.post(`/api/interviews/${t.draftId}/resume`).attach('resume', pdfBytes, 'r.pdf')).status).toBe(404);
    expect((await request(t.app).post(`/api/interviews/${t.draftId}/resume`).attach('resume', pdfBytes, 'r.pdf')).status).toBe(401);
    const { id } = await readyInterview(t.recruiter);
    expect((await t.recruiter.post(`/api/interviews/${id}/resume`).attach('resume', pdfBytes, 'r.pdf')).status).toBe(409);
  });
});

describe('AI question generation (PRD §8.2)', () => {
  beforeEach(resetDb);

  it('generates the default 10 questions from the role and resume, saved as AI drafts', async () => {
    const t = await setup();
    await t.recruiter.post(`/api/interviews/${t.draftId}/resume`).attach('resume', pdfBytes, 'resume.pdf');
    const res = await t.recruiter.post(`/api/interviews/${t.draftId}/questions/generate`).send({});
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(10);
    expect(res.body.questions[0]).toMatchObject({ sequence: 1, source: 'AI_GENERATED', evaluationCriteria: ['Correctness', 'Clarity'] });
    expect(t.llm.questionRequests[0]).toMatchObject({ count: 10, resumeText: t.documents.text, categories: ['TECHNICAL', 'RESUME'], requiredSkills: ['Node.js', 'PostgreSQL'] });
    expect(await testDb().question.count({ where: { interviewId: t.draftId } })).toBe(10);
  });

  it('honours an explicit count and ignores duplicates or unrequested categories', async () => {
    const t = await setup();
    t.llm.nextQuestions = [
      [q('Explain database indexes in depth.'), q('explain   DATABASE indexes in depth.'), q('Design a URL shortener for us.', 'SYSTEM_DESIGN')],
      [q('Explain database indexes in depth.'), q('How do you handle retries safely?'), q('Describe your last project.', 'RESUME')],
    ];
    const res = await t.recruiter.post(`/api/interviews/${t.draftId}/questions/generate`).send({ count: 3 });
    expect(res.status).toBe(200);
    expect(res.body.questions.map((x: { text: string }) => x.text)).toEqual([
      'Explain database indexes in depth.',
      'How do you handle retries safely?',
      'Describe your last project.',
    ]);
    expect(t.llm.questionRequests).toHaveLength(2);
  });

  it('fails honestly instead of saving too few questions, and keeps the old set', async () => {
    const t = await setup();
    await t.recruiter.patch(`/api/interviews/${t.draftId}/questions`).send({ questions: [{ text: 'My own question here?', category: 'TECHNICAL', difficulty: 'EASY', source: 'RECRUITER' }] });
    t.llm.nextQuestions = [[q('Only one question came back?')], [q('Only one question came back?')]];
    const res = await t.recruiter.post(`/api/interviews/${t.draftId}/questions/generate`).send({ count: 5 });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/1 usable questions instead of 5/);
    expect((await t.recruiter.get(`/api/interviews/${t.draftId}`)).body.questions.map((x: { text: string }) => x.text)).toEqual(['My own question here?']);
  });

  it('maps provider timeouts and failures to distinct errors', async () => {
    const t = await setup();
    t.llm.failWith = new LlmError('PROVIDER_TIMEOUT', 'The AI provider took too long to respond.');
    const slow = await t.recruiter.post(`/api/interviews/${t.draftId}/questions/generate`).send({});
    expect(slow.status).toBe(504);
    expect(slow.body.error.code).toBe('PROVIDER_TIMEOUT');
    t.llm.failWith = new LlmError('PROVIDER_RATE_LIMITED', 'The AI provider is busy (rate limit). Try again in a minute.');
    const busy = await t.recruiter.post(`/api/interviews/${t.draftId}/questions/generate`).send({});
    expect(busy.status).toBe(503);
    expect(busy.body.error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: expect.stringMatching(/rate limit/) });
    expect((await t.recruiter.post(`/api/interviews/${t.draftId}/questions/generate`).send({ count: 31 })).status).toBe(400);
  });
});

describe('AI evaluation (PRD §8.3)', () => {
  beforeEach(resetDb);

  it('scores only answered questions, keeps verified evidence, and runs one job at a time', async () => {
    const t = await setup();
    const { id, transcript } = await completedInterview(t);

    let release!: () => void;
    t.llm.gate = new Promise((resolve) => (release = resolve));
    const started = await t.recruiter.post(`/api/interviews/${id}/evaluate`);
    expect(started.status).toBe(202);
    expect(started.body).toEqual({ evaluationStatus: 'EVALUATING' });
    // A second click while running does not start another job.
    expect((await t.recruiter.post(`/api/interviews/${id}/evaluate`)).body).toEqual({ evaluationStatus: 'EVALUATING' });
    expect((await t.recruiter.get(`/api/interviews/${id}/report`)).body.evaluationStatus).toBe('EVALUATING');
    release();
    await t.services.evaluationRunner.whenIdle();

    expect(t.llm.evaluationRequests).toHaveLength(1);
    expect(t.llm.evaluationRequests[0]!.transcript).toBe(transcript);
    const report = (await t.recruiter.get(`/api/interviews/${id}/report`)).body;
    expect(report).toMatchObject({ interview: { status: 'EVALUATED' }, evaluationStatus: 'EVALUATED', overall: { score: 7.3 } });
    const [answered, skipped, unanswered] = report.items;
    expect(answered.evaluation).toMatchObject({ score: 7.3, maxScore: 10, reviewStatus: 'AI_ONLY', criteria: [{ criterion: 'Correctness', score: 7, maxScore: 10 }] });
    // The invented quote is dropped; the real one is kept.
    expect(answered.evaluation.evidence).toEqual(['Authentication proves who you']);
    expect(skipped.evaluation).toBeNull();
    expect(unanswered.evaluation).toBeNull();
    expect(t.events.of('evaluation.status_changed').map((e) => e.status)).toEqual(['EVALUATING', 'EVALUATED']);
  });

  it('marks a provider failure as EVALUATION_FAILED without touching answers, and can be retried', async () => {
    const t = await setup();
    const { id, transcript } = await completedInterview(t);
    t.llm.failWith = new LlmError('PROVIDER_TIMEOUT', 'slow');
    await t.recruiter.post(`/api/interviews/${id}/evaluate`);
    await t.services.evaluationRunner.whenIdle();
    let report = (await t.recruiter.get(`/api/interviews/${id}/report`)).body;
    expect(report).toMatchObject({ interview: { status: 'EVALUATION_FAILED' }, evaluationStatus: 'FAILED', evaluationFailureCode: 'PROVIDER_TIMEOUT' });
    expect(report.items[0].answer.transcript).toBe(transcript);

    t.llm.failWith = null;
    expect((await t.recruiter.post(`/api/interviews/${id}/evaluate`)).status).toBe(202);
    await t.services.evaluationRunner.whenIdle();
    report = (await t.recruiter.get(`/api/interviews/${id}/report`)).body;
    expect(report).toMatchObject({ evaluationStatus: 'EVALUATED', evaluationFailureCode: null });
  });

  it('keeps a reviewer override when evaluation is re-run', async () => {
    const t = await setup();
    const { id } = await completedInterview(t);
    await t.recruiter.post(`/api/interviews/${id}/evaluate`);
    await t.services.evaluationRunner.whenIdle();
    const evaluationId = (await t.recruiter.get(`/api/interviews/${id}/report`)).body.items[0].evaluation.id;
    await t.recruiter.patch(`/api/evaluations/${evaluationId}/review`).send({ reviewStatus: 'OVERRIDDEN', score: 9, reason: 'Strong practical example.' });
    expect((await t.recruiter.get(`/api/interviews/${id}`)).body.status).toBe('REVIEWED');

    await t.recruiter.post(`/api/interviews/${id}/evaluate`);
    await t.services.evaluationRunner.whenIdle();
    const item = (await t.recruiter.get(`/api/interviews/${id}/report`)).body.items[0];
    expect(item.evaluation).toMatchObject({ score: 7.3, reviewStatus: 'OVERRIDDEN', override: { score: 9, reason: 'Strong practical example.' } });
  });

  it('refuses to evaluate unfinished interviews and fails lost jobs after a restart', async () => {
    const t = await setup();
    const { id } = await readyInterview(t.recruiter);
    expect((await t.recruiter.post(`/api/interviews/${id}/evaluate`)).status).toBe(409);

    await testDb().interview.update({ where: { id }, data: { status: 'EVALUATING', evaluationStatus: 'EVALUATING', updatedAt: new Date(Date.now() - 20 * 60_000) } });
    expect(await t.services.evaluationRunner.failInterrupted(15 * 60_000)).toBe(1);
    expect((await t.recruiter.get(`/api/interviews/${id}/report`)).body).toMatchObject({ evaluationStatus: 'FAILED', evaluationFailureCode: 'INTERRUPTED' });
  });
});

describe('server PDF export (PRD §15.1)', () => {
  beforeEach(resetDb);

  it('downloads the authorized report as a PDF, and nobody else’s', async () => {
    const t = await setup();
    const { id } = await completedInterview(t);
    await t.recruiter.post(`/api/interviews/${id}/evaluate`);
    await t.services.evaluationRunner.whenIdle();

    const res = await t.recruiter.get(`/api/interviews/${id}/export.pdf`).buffer(true).responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="hirebyte-report-${id.slice(0, 8)}.pdf"`);
    expect(res.headers['cache-control']).toBe('no-store');
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);

    await createRecruiter('other@example.test', 'Other');
    const other = await recruiterAgent(t.app, 'other@example.test');
    expect((await other.get(`/api/interviews/${id}/export.pdf`)).status).toBe(404);
    expect((await request(t.app).get(`/api/interviews/${id}/export.pdf`)).status).toBe(401);
  });
});
