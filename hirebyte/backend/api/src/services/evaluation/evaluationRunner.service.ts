import type * as Api from '@contracts';
import type { AppDeps } from '../../context.js';
import type { InterviewStatus } from '../../generated/prisma/client.js';
import { Errors } from '../../lib/errors.js';
import { logger, safeError } from '../../lib/logger.js';
import { LlmError } from '../../providers/llm/llm.types.js';
import { publishStatus } from '../../realtime/eventHub.js';
import { recordAudit } from '../../repositories/auditEvent.repository.js';
import { rubricSchema } from '../../schemas/question.schema.js';
import type { AuthUser } from '../auth/auth.service.js';
import { findInterviewForUser } from '../interviews/interview.service.js';
import { transitionInterview } from '../interviews/stateMachine.js';

const EVALUABLE: InterviewStatus[] = ['COMPLETED', 'EVALUATION_FAILED', 'EVALUATED', 'REVIEWED'];
const MAX_EVIDENCE = 5;

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Keeps only quotes that really appear in the transcript, so evidence is never invented (PRD §13). */
export function verifiedEvidence(quotes: string[], transcript: string): string[] {
  const haystack = normalize(transcript);
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const quote of quotes) {
    const needle = normalize(quote).replace(/^[.,;:!?…-]+|[.,;:!?…-]+$/g, '').trim();
    if (needle.length < 3 || seen.has(needle) || !haystack.includes(needle)) continue;
    seen.add(needle);
    kept.push(quote.trim());
    if (kept.length === MAX_EVIDENCE) break;
  }
  return kept;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Rubric-based evaluation with Grok (PRD §8.3). Runs in the background after the recruiter asks for
 * it; one job per interview at a time, enforced by the EVALUATING state.
 */
export function createEvaluationRunner(deps: AppDeps) {
  const { db, llm, events, now } = deps;
  const running = new Map<string, Promise<void>>();

  const announce = (interviewId: string, status: InterviewStatus, evaluationStatus: Api.EvaluationStatus) => {
    publishStatus(events, interviewId, status, now());
    events.publish('evaluation.status_changed', { interviewId, status: evaluationStatus, timestamp: now().toISOString() });
  };

  async function run(interviewId: string): Promise<void> {
    if (!llm) return;
    try {
      const interview = await db.interview.findUniqueOrThrow({
        where: { id: interviewId },
        include: { questions: { orderBy: { sequence: 'asc' }, include: { answer: true } } },
      });
      for (const question of interview.questions) {
        const transcript = question.answer?.status === 'ANSWERED' ? question.answer.transcript.trim() : '';
        // Skipped and unanswered questions are not scored at all, which is different from a zero.
        if (!transcript) continue;
        const rubric = rubricSchema.safeParse(question.rubric);
        const result = await llm.evaluateAnswer({
          jobTitle: interview.jobTitle,
          requiredSkills: interview.requiredSkills,
          question: {
            text: question.text,
            category: question.category,
            difficulty: question.difficulty,
            evaluationCriteria: rubric.success ? rubric.data.evaluationCriteria : [],
            expectedAnswerPoints: rubric.success ? rubric.data.expectedAnswerPoints : [],
          },
          transcript,
        });
        const ai = {
          score: round1(result.score),
          maxScore: 10,
          criteria: result.criteria.map((c) => ({ criterion: c.criterion, score: round1(c.score), maxScore: 10 })),
          evidence: verifiedEvidence(result.evidence, transcript),
          explanation: result.explanation,
          strengths: result.strengths,
          gaps: result.gaps,
        };
        // A re-run refreshes the AI fields only; a reviewer's earlier override is kept.
        await db.evaluation.upsert({ where: { questionId: question.id }, create: { interviewId, questionId: question.id, ...ai }, update: ai });
      }

      if (await transitionInterview(db, interviewId, 'EVALUATING', 'EVALUATED', { evaluationStatus: 'EVALUATED', evaluationFailureCode: null })) {
        announce(interviewId, 'EVALUATED', 'EVALUATED');
        await recordAudit(db, { actorRole: 'SYSTEM', action: 'evaluation.completed', resourceType: 'interview', resourceId: interviewId });
      }
    } catch (err) {
      const detail = err instanceof LlmError ? err.code : 'EVALUATION_ERROR';
      // The report page explains these two codes; the precise reason goes to the audit log.
      const failureCode = detail === 'PROVIDER_TIMEOUT' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE';
      logger.warn('evaluation failed', { interviewId, code: detail, ...safeError(err) });
      if (await transitionInterview(db, interviewId, 'EVALUATING', 'EVALUATION_FAILED', { evaluationStatus: 'FAILED', evaluationFailureCode: failureCode })) {
        announce(interviewId, 'EVALUATION_FAILED', 'FAILED');
        await recordAudit(db, { actorRole: 'SYSTEM', action: 'evaluation.failed', resourceType: 'interview', resourceId: interviewId, metadata: { code: detail } });
      }
    }
  }

  return {
    /** POST /interviews/:id/evaluate: starts (or re-runs) evaluation; repeating while it runs is a no-op. */
    async start(user: AuthUser, interviewId: string): Promise<Api.EvaluateResponse> {
      const interview = await findInterviewForUser(db, user, interviewId);
      if (!llm) throw Errors.notConfigured('PROVIDER_UNAVAILABLE', 'AI evaluation is not set up on this server yet. All answers are saved.');
      if (interview.status === 'EVALUATING') return { evaluationStatus: 'EVALUATING' };
      if (!EVALUABLE.includes(interview.status)) throw Errors.conflict('Evaluation can only run after the interview is completed.');

      const moved = await transitionInterview(db, interviewId, interview.status, 'EVALUATING', { evaluationStatus: 'EVALUATING', evaluationFailureCode: null });
      if (!moved) return { evaluationStatus: 'EVALUATING' };
      announce(interviewId, 'EVALUATING', 'EVALUATING');
      await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'evaluation.started', resourceType: 'interview', resourceId: interviewId });

      const job = run(interviewId).finally(() => running.delete(interviewId));
      running.set(interviewId, job);
      return { evaluationStatus: 'EVALUATING' };
    },

    /**
     * Marks evaluations stuck in EVALUATING (e.g. the server restarted mid-job) as failed so they
     * can be retried. Jobs running in this process are left alone.
     */
    async failInterrupted(olderThanMs: number): Promise<number> {
      const stuck = await db.interview.findMany({
        where: { status: 'EVALUATING', updatedAt: { lt: new Date(now().getTime() - olderThanMs) } },
        select: { id: true },
      });
      let failed = 0;
      for (const { id } of stuck) {
        if (running.has(id)) continue;
        if (await transitionInterview(db, id, 'EVALUATING', 'EVALUATION_FAILED', { evaluationStatus: 'FAILED', evaluationFailureCode: 'INTERRUPTED' })) {
          announce(id, 'EVALUATION_FAILED', 'FAILED');
          failed += 1;
        }
      }
      return failed;
    },

    /** Resolves when every running job has finished (tests and graceful shutdown). */
    async whenIdle(): Promise<void> {
      await Promise.all([...running.values()]);
    },
  };
}

export type EvaluationRunner = ReturnType<typeof createEvaluationRunner>;
