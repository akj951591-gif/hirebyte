import type { InterviewStatus } from '@/api/client';
import { StatusBadge, type Tone } from '@/components/StatusBadge';

/** Recruiter-facing labels for the backend state machine (PRD §7.2, §8.1). */
export const interviewStatusMeta: Record<InterviewStatus, { label: string; tone: Tone; live?: boolean }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  READY: { label: 'Ready', tone: 'brand' },
  ONBOARDING: { label: 'Onboarding', tone: 'info', live: true },
  IN_PROGRESS: { label: 'In progress', tone: 'info', live: true },
  PROCESSING_ANSWER: { label: 'In progress', tone: 'info', live: true },
  COMPLETED: { label: 'Completed', tone: 'success' },
  EVALUATING: { label: 'Processing', tone: 'warning', live: true },
  EVALUATED: { label: 'Evaluated', tone: 'success' },
  EVALUATION_FAILED: { label: 'Evaluation failed', tone: 'danger' },
  REVIEWED: { label: 'Reviewed', tone: 'brand' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

/** Statuses offered in recruiter filters (merged states like PROCESSING_ANSWER are left out). */
export const filterableStatuses: InterviewStatus[] = [
  'DRAFT',
  'READY',
  'IN_PROGRESS',
  'COMPLETED',
  'EVALUATING',
  'EVALUATED',
  'EVALUATION_FAILED',
  'REVIEWED',
  'CANCELLED',
];

export function InterviewStatusBadge({ status }: { status: InterviewStatus }) {
  const meta = interviewStatusMeta[status];
  return (
    <StatusBadge tone={meta.tone} live={meta.live}>
      {meta.label}
    </StatusBadge>
  );
}
