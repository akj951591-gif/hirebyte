import type * as Api from '@contracts';
import type { AppDeps } from '../../context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { Errors } from '../../lib/errors.js';
import type { AuthUser } from '../auth/auth.service.js';
import { overallScore, toConversationTurn, toProctoringEvent, toQuestion, toSummary, summaryInclude } from '../interviews/dto.js';
import { ownershipScope } from '../interviews/interview.service.js';

type EvaluationRow = Prisma.EvaluationGetPayload<{ include: { reviewer: { select: { name: true } } } }>;

export function toEvaluation(e: EvaluationRow): Api.Evaluation {
  const criteria = Array.isArray(e.criteria) ? (e.criteria as unknown as Api.CriterionScore[]) : [];
  return {
    id: e.id,
    questionId: e.questionId,
    score: e.score,
    maxScore: e.maxScore,
    criteria,
    evidence: e.evidence,
    explanation: e.explanation,
    strengths: e.strengths,
    gaps: e.gaps,
    reviewStatus: e.reviewStatus,
    override:
      e.reviewStatus === 'OVERRIDDEN' && e.overrideScore !== null
        ? { score: e.overrideScore, reason: e.overrideReason ?? '', reviewerName: e.reviewer?.name ?? 'Reviewer', reviewedAt: (e.reviewedAt ?? e.updatedAt).toISOString() }
        : null,
  };
}

/** Recruiter report built from persisted answers and evaluations only (PRD §8.3, §15.1). */
export function createReportService({ db }: AppDeps) {
  return {
    async report(user: AuthUser, id: string): Promise<Api.InterviewReport> {
      const interview = await db.interview.findFirst({
        where: { id, ...ownershipScope(user) },
        include: {
          ...summaryInclude,
          questions: { orderBy: { sequence: 'asc' }, include: { answer: true, evaluation: { include: { reviewer: { select: { name: true } } } } } },
          proctoringEvents: { orderBy: { occurredAt: 'asc' } },
          conversationTurns: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!interview) throw Errors.notFound('Interview');

      const evaluations = interview.questions.flatMap((q) => (q.evaluation ? [q.evaluation] : []));
      const score = overallScore(evaluations);
      const scored = evaluations.filter((e) => e.score !== null);
      const overall: Api.OverallAssessment | null =
        score === null
          ? null
          : {
              score,
              maxScore: 10,
              summary: `Average of ${scored.length} evaluated answer${scored.length === 1 ? '' : 's'}, including reviewer overrides. Read the per-question evidence before deciding next steps.`,
              strengths: [...new Set(scored.flatMap((e) => e.strengths))].slice(0, 5),
              gaps: [...new Set(scored.flatMap((e) => e.gaps))].slice(0, 5),
            };

      return {
        interview: { ...toSummary(interview), requiredSkills: interview.requiredSkills },
        evaluationStatus: interview.evaluationStatus,
        evaluationFailureCode: interview.evaluationFailureCode,
        overall,
        items: interview.questions.map((q) => ({
          question: toQuestion(q),
          answer: q.answer
            ? {
                id: q.answer.id,
                status: q.answer.status,
                transcript: q.answer.transcript,
                durationSeconds: q.answer.durationSeconds,
                inputMode: q.answer.inputMode,
                submittedAt: q.answer.submittedAt?.toISOString() ?? null,
              }
            : null,
          evaluation: q.evaluation ? toEvaluation(q.evaluation) : null,
        })),
        proctoringEvents: interview.proctoringEvents.map(toProctoringEvent),
        conversation: interview.conversationTurns.map(toConversationTurn),
        generatedAt: new Date().toISOString(),
      };
    },
  };
}

export type ReportService = ReturnType<typeof createReportService>;
