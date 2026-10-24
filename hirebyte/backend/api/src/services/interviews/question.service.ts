import type * as Api from '@contracts';
import type { z } from 'zod';
import type { AppDeps } from '../../context.js';
import { AppError, Errors } from '../../lib/errors.js';
import { LlmError, providerFailure, type GeneratedQuestion } from '../../providers/llm/llm.types.js';
import { recordAudit } from '../../repositories/auditEvent.repository.js';
import { replaceQuestions } from '../../repositories/question.repository.js';
import type { generateQuestionsSchema, updateQuestionsSchema } from '../../schemas/question.schema.js';
import type { AuthUser } from '../auth/auth.service.js';
import { parseConfig, toQuestion } from './dto.js';
import { findInterviewForUser } from './interview.service.js';

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

export function createQuestionService({ db, llm }: AppDeps) {
  return {
    /** Saves the recruiter-approved set; array order becomes the stable interview order (PRD §8.1). */
    async replace(user: AuthUser, interviewId: string, input: z.infer<typeof updateQuestionsSchema>): Promise<Api.UpdateQuestionsResponse> {
      const interview = await findInterviewForUser(db, user, interviewId);
      if (interview.status !== 'DRAFT') throw Errors.conflict('Questions are locked once the interview is ready.');
      const saved = await db.$transaction((tx) => replaceQuestions(tx, interviewId, input.questions));
      await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'interview.questions_saved', resourceType: 'interview', resourceId: interviewId, metadata: { count: saved.length } });
      return { questions: saved.map(toQuestion) };
    },

    /**
     * Generates questions with Grok (PRD §8.2) from the job description, skills and extracted resume,
     * then saves them as the draft's question set for the recruiter to review and edit.
     */
    async generate(user: AuthUser, interviewId: string, input: z.infer<typeof generateQuestionsSchema>): Promise<Api.GenerateQuestionsResponse> {
      const interview = await findInterviewForUser(db, user, interviewId);
      if (!llm) throw Errors.notConfigured('PROVIDER_UNAVAILABLE', 'The AI question generator is not set up on this server yet. Add questions manually for now.');
      if (interview.status !== 'DRAFT') throw Errors.conflict('Questions can only be generated while the interview is a draft.');

      const config = parseConfig(interview.config);
      const count = input.count ?? config.questionCount;
      const resume = await db.resume.findUnique({ where: { interviewId }, select: { extractedText: true, extractionStatus: true } });
      const request = {
        jobTitle: interview.jobTitle,
        jobDescription: interview.jobDescription,
        requiredSkills: interview.requiredSkills,
        resumeText: resume?.extractionStatus === 'COMPLETED' ? resume.extractedText : null,
        count,
        difficulty: config.difficulty,
        experienceLevel: config.experienceLevel,
        categories: config.categories,
      };

      // Keep distinct questions in the allowed categories; ask once more if the model came up short.
      let usable: GeneratedQuestion[] = [];
      for (let attempt = 0; attempt < 2 && usable.length < count; attempt += 1) {
        let generated: GeneratedQuestion[];
        try {
          generated = await llm.generateQuestions(request);
        } catch (err) {
          if (err instanceof LlmError) throw providerFailure(err);
          throw err;
        }
        const seen = new Set(usable.map((q) => normalize(q.text)));
        for (const q of generated) {
          const key = normalize(q.text);
          if (!config.categories.includes(q.category) || seen.has(key)) continue;
          seen.add(key);
          usable.push(q);
        }
      }
      if (usable.length < count) {
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', `The AI returned ${usable.length} usable questions instead of ${count}. Try again, or add questions manually.`);
      }
      usable = usable.slice(0, count);

      const saved = await db.$transaction((tx) => replaceQuestions(tx, interviewId, usable.map((q) => ({ ...q, source: 'AI_GENERATED' as const }))));
      await recordAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        action: 'interview.questions_generated',
        resourceType: 'interview',
        resourceId: interviewId,
        metadata: { count: saved.length, usedResume: request.resumeText !== null },
      });
      return { questions: saved.map(toQuestion) };
    },
  };
}

export type QuestionService = ReturnType<typeof createQuestionService>;
