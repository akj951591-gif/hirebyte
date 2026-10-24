import { z } from 'zod';
import { difficulty, MAX_QUESTION_COUNT, questionCategory } from './interview.schema.js';

export const questionSource = z.enum(['AI_GENERATED', 'RECRUITER', 'FOLLOW_UP']);

export const questionDraftSchema = z.object({
  id: z.uuid().optional(),
  text: z.string().trim().min(1, 'Questions cannot be empty.').max(2000),
  category: questionCategory,
  difficulty,
  targetSkills: z.array(z.string().trim().max(80)).max(20).default([]),
  evaluationCriteria: z.array(z.string().trim().max(500)).max(20).default([]),
  expectedAnswerPoints: z.array(z.string().trim().max(500)).max(20).default([]),
  source: questionSource,
});

export const updateQuestionsSchema = z.object({
  questions: z
    .array(questionDraftSchema)
    .min(1, 'Add at least one question.')
    .max(MAX_QUESTION_COUNT, `An interview can have at most ${MAX_QUESTION_COUNT} questions.`)
    .refine((qs) => new Set(qs.map((q) => q.text.toLowerCase())).size === qs.length, 'Remove duplicate questions before saving.'),
});

/** Stored in Question.rubric (JSON). */
export const rubricSchema = z.object({
  evaluationCriteria: z.array(z.string()).default([]),
  expectedAnswerPoints: z.array(z.string()).default([]),
});

/** POST /interviews/:id/questions/generate. Omitted count = the interview's configured count (default 10). */
export const generateQuestionsSchema = z.object({
  count: z.number().int().min(1).max(MAX_QUESTION_COUNT).optional(),
});
