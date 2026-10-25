import { z } from 'zod';

export const MAX_TRANSCRIPT_CHARS = 20_000;

export const consentSchema = z.object({
  recordingNoticeVersion: z.string().min(1).max(64),
  proctoringNoticeVersion: z.string().min(1).max(64),
  recordingConsent: z.boolean(),
  proctoringConsent: z.boolean(),
});

const idempotencyKey = z.string().min(8).max(100);

export const submitAnswerSchema = z.object({
  questionId: z.uuid(),
  transcript: z.string().max(MAX_TRANSCRIPT_CHARS, 'Your answer is too long.'),
  durationSeconds: z.number().min(0).max(4 * 3600),
  inputMode: z.enum(['VOICE', 'TEXT']),
  idempotencyKey,
});

export const skipQuestionSchema = z.object({
  questionId: z.uuid(),
  idempotencyKey,
});

export const proctoringEventSchema = z.object({
  type: z.enum(['FACE_ABSENT', 'MULTIPLE_FACES', 'LOOKING_AWAY', 'TAB_HIDDEN', 'AUDIO_ISSUE']),
  occurredAt: z.iso.datetime().optional(),
  durationSeconds: z.number().min(0).max(4 * 3600).optional(),
  sourceCamera: z.enum(['PRIMARY', 'SECONDARY']).default('PRIMARY'),
  description: z.string().trim().max(500).optional(),
});

/** POST /candidate/sessions/:sessionId/ask */
export const askInterviewerSchema = z.object({
  questionId: z.uuid(),
  message: z.string().trim().min(2, 'Type your question for the interviewer.').max(500, 'Please keep your question shorter.'),
});

/** POST /interviews/:id/phone-events: the paired phone authenticates with its device token. */
export const phoneEventSchema = proctoringEventSchema.extend({
  deviceToken: z.string().min(20).max(200),
});
