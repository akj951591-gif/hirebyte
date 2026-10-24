import { z } from 'zod';

export const reviewEvaluationSchema = z
  .object({
    reviewStatus: z.enum(['CONFIRMED', 'OVERRIDDEN']),
    score: z.number().min(0).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.reviewStatus !== 'OVERRIDDEN' || (v.score !== undefined && Boolean(v.reason)), {
    message: 'An override needs a score and a reason.',
  });

export const reviewProctoringEventSchema = z.object({
  reviewStatus: z.enum(['UNREVIEWED', 'NO_CONCERN', 'NEEDS_FOLLOW_UP']),
  reviewerNote: z.string().trim().max(1000).optional(),
});
