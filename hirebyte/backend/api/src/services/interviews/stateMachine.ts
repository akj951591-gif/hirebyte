import type { InterviewStatus, Prisma } from '../../generated/prisma/client.js';
import { Errors } from '../../lib/errors.js';
import type { DbOrTx } from '../../repositories/prisma.js';

/**
 * Backend-owned interview lifecycle (PRD §8.1):
 * DRAFT → READY → ONBOARDING → IN_PROGRESS ↔ PROCESSING_ANSWER → COMPLETED → EVALUATING → EVALUATED → REVIEWED,
 * plus CANCELLED and EVALUATION_FAILED.
 */
const transitions: Record<InterviewStatus, InterviewStatus[]> = {
  DRAFT: ['READY', 'CANCELLED'],
  READY: ['ONBOARDING', 'CANCELLED'],
  ONBOARDING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['PROCESSING_ANSWER', 'COMPLETED', 'CANCELLED'],
  PROCESSING_ANSWER: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  COMPLETED: ['EVALUATING'],
  EVALUATING: ['EVALUATED', 'EVALUATION_FAILED'],
  EVALUATION_FAILED: ['EVALUATING'],
  EVALUATED: ['REVIEWED', 'EVALUATING'],
  REVIEWED: ['EVALUATING'],
  CANCELLED: [],
};

export const LIVE_STATUSES: readonly InterviewStatus[] = ['ONBOARDING', 'IN_PROGRESS', 'PROCESSING_ANSWER'];
export const FINISHED_STATUSES: readonly InterviewStatus[] = ['COMPLETED', 'EVALUATING', 'EVALUATED', 'EVALUATION_FAILED', 'REVIEWED'];
export const PENDING_REVIEW_STATUSES: readonly InterviewStatus[] = ['COMPLETED', 'EVALUATING', 'EVALUATED', 'EVALUATION_FAILED'];
export const RUNNING_STATUSES: readonly InterviewStatus[] = ['IN_PROGRESS', 'PROCESSING_ANSWER'];
export const CANCELLABLE_STATUSES: readonly InterviewStatus[] = (Object.keys(transitions) as InterviewStatus[]).filter((s) =>
  transitions[s].includes('CANCELLED'),
);

export function canTransition(from: InterviewStatus, to: InterviewStatus): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(from: InterviewStatus, to: InterviewStatus): void {
  if (!canTransition(from, to)) {
    throw Errors.conflict(`An interview cannot move from ${from} to ${to}.`);
  }
}

export const isLive = (s: InterviewStatus) => LIVE_STATUSES.includes(s);
export const isFinished = (s: InterviewStatus) => FINISHED_STATUSES.includes(s);
export const isRunning = (s: InterviewStatus) => RUNNING_STATUSES.includes(s);

/**
 * The only way an interview's status changes. Each move is checked against the lifecycle table, then
 * applied only if the row is still in one of `from`, so concurrent requests cannot both win.
 * Returns false when another request already moved the interview.
 */
export async function transitionInterview(
  db: DbOrTx,
  id: string,
  from: InterviewStatus | readonly InterviewStatus[],
  to: InterviewStatus,
  data: Omit<Prisma.InterviewUpdateManyMutationInput, 'status'> = {},
): Promise<boolean> {
  const sources: InterviewStatus[] = typeof from === 'string' ? [from] : [...from];
  for (const source of sources) assertTransition(source, to);
  const { count } = await db.interview.updateMany({ where: { id, status: { in: sources } }, data: { ...data, status: to } });
  return count > 0;
}
