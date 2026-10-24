import type { z } from 'zod';
import type { questionDraftSchema } from '../schemas/question.schema.js';
import type { Tx } from './prisma.js';

/**
 * Replaces a draft interview's questions. Only valid before any answers exist (DRAFT), so a
 * delete + recreate is safe; ids the client sends back are kept so they stay stable.
 */
export async function replaceQuestions(tx: Tx, interviewId: string, drafts: Array<z.infer<typeof questionDraftSchema>>) {
  const existing = new Set((await tx.question.findMany({ where: { interviewId }, select: { id: true } })).map((q) => q.id));
  await tx.question.deleteMany({ where: { interviewId } });
  await tx.question.createMany({
    data: drafts.map((q, index) => ({
      // Ignore ids that do not belong to this interview; the database assigns a new one.
      ...(q.id && existing.has(q.id) ? { id: q.id } : {}),
      interviewId,
      sequence: index + 1,
      text: q.text,
      category: q.category,
      difficulty: q.difficulty,
      targetSkills: q.targetSkills,
      rubric: { evaluationCriteria: q.evaluationCriteria, expectedAnswerPoints: q.expectedAnswerPoints },
      source: q.source,
    })),
  });
  return tx.question.findMany({ where: { interviewId }, orderBy: { sequence: 'asc' } });
}
