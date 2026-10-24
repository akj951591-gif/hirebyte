import type * as Api from '@contracts';
import type { z } from 'zod';
import type { AppDeps } from '../../context.js';
import { Errors } from '../../lib/errors.js';
import { publishStatus } from '../../realtime/eventHub.js';
import { recordAudit } from '../../repositories/auditEvent.repository.js';
import type { reviewEvaluationSchema, reviewProctoringEventSchema } from '../../schemas/evaluation.schema.js';
import type { AuthUser } from '../auth/auth.service.js';
import { toProctoringEvent } from '../interviews/dto.js';
import { findInterviewForUser } from '../interviews/interview.service.js';
import { transitionInterview } from '../interviews/stateMachine.js';
import { toEvaluation } from './report.service.js';

/**
 * Human review of AI evaluations and observations. Generating evaluations (Grok) is workstream E;
 * POST /interviews/:id/evaluate answers "not configured" until that provider exists.
 */
export function createEvaluationService({ db, now, events }: AppDeps) {
  return {
    async review(user: AuthUser, evaluationId: string, body: z.infer<typeof reviewEvaluationSchema>): Promise<Api.Evaluation> {
      const existing = await db.evaluation.findUnique({ where: { id: evaluationId } });
      if (!existing) throw Errors.notFound('Evaluation');
      const interview = await findInterviewForUser(db, user, existing.interviewId);
      if (body.reviewStatus === 'OVERRIDDEN' && (body.score! < 0 || body.score! > existing.maxScore)) {
        throw Errors.validation(`Score must be between 0 and ${existing.maxScore}.`, { score: 'Out of range.' });
      }
      // The original AI score stays in `score`; the override sits alongside it (PRD §8.3).
      const updated = await db.evaluation.update({
        where: { id: evaluationId },
        data: {
          reviewStatus: body.reviewStatus,
          overrideScore: body.reviewStatus === 'OVERRIDDEN' ? body.score : null,
          overrideReason: body.reviewStatus === 'OVERRIDDEN' ? body.reason : null,
          reviewerId: user.id,
          reviewedAt: now(),
        },
        include: { reviewer: { select: { name: true } } },
      });
      const remaining = await db.evaluation.count({ where: { interviewId: interview.id, reviewStatus: 'AI_ONLY' } });
      if (remaining === 0 && (await transitionInterview(db, interview.id, 'EVALUATED', 'REVIEWED'))) {
        publishStatus(events, interview.id, 'REVIEWED', now());
      }
      await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'evaluation.reviewed', resourceType: 'evaluation', resourceId: evaluationId, metadata: { reviewStatus: body.reviewStatus } });
      return toEvaluation(updated);
    },

    async reviewEvent(user: AuthUser, eventId: string, body: z.infer<typeof reviewProctoringEventSchema>): Promise<Api.ProctoringEvent> {
      const event = await db.proctoringEvent.findUnique({ where: { id: eventId } });
      if (!event) throw Errors.notFound('Event');
      await findInterviewForUser(db, user, event.interviewId);
      const updated = await db.proctoringEvent.update({
        where: { id: eventId },
        data: { reviewStatus: body.reviewStatus, reviewerNote: body.reviewerNote || null, reviewerId: user.id, reviewedAt: now() },
      });
      return toProctoringEvent(updated);
    },
  };
}

export type EvaluationService = ReturnType<typeof createEvaluationService>;
