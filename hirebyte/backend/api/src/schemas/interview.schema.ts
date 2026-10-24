import { z } from 'zod';

export const difficulty = z.enum(['EASY', 'MEDIUM', 'HARD']);
export const experienceLevel = z.enum(['INTERN', 'JUNIOR', 'MID', 'SENIOR', 'LEAD']);
export const questionCategory = z.enum(['TECHNICAL', 'BEHAVIORAL', 'SITUATIONAL', 'RESUME', 'SYSTEM_DESIGN']);
export const secondaryCameraPolicy = z.enum(['OFF', 'OPTIONAL', 'REQUIRED']);
export const interviewStatus = z.enum([
  'DRAFT',
  'READY',
  'ONBOARDING',
  'IN_PROGRESS',
  'PROCESSING_ANSWER',
  'COMPLETED',
  'EVALUATING',
  'EVALUATED',
  'EVALUATION_FAILED',
  'REVIEWED',
  'CANCELLED',
]);

export const DEFAULT_QUESTION_COUNT = 10;
export const MAX_QUESTION_COUNT = 30;

/** Validation rules for each config field, without defaults (shared by create and partial updates). */
const configRules = {
  questionCount: z.number().int().min(1).max(MAX_QUESTION_COUNT),
  durationMinutes: z.number().int().min(5).max(120),
  difficulty,
  experienceLevel,
  categories: z.array(questionCategory).min(1).max(5),
  allowSkip: z.boolean(),
  allowFollowUps: z.boolean(),
  maxFollowUps: z.number().int().min(0).max(3),
  secondaryCamera: secondaryCameraPolicy,
  recordingEnabled: z.boolean(),
};

/** Stored interview config. Defaults applied here so the backend stays authoritative (PRD §19). */
export const interviewConfigSchema = z.object({
  questionCount: configRules.questionCount.default(DEFAULT_QUESTION_COUNT),
  durationMinutes: configRules.durationMinutes.default(30),
  difficulty: configRules.difficulty.default('MEDIUM'),
  experienceLevel: configRules.experienceLevel.default('MID'),
  categories: configRules.categories.default(['TECHNICAL', 'BEHAVIORAL']),
  allowSkip: configRules.allowSkip.default(true),
  allowFollowUps: configRules.allowFollowUps.default(false),
  maxFollowUps: configRules.maxFollowUps.default(0),
  secondaryCamera: configRules.secondaryCamera.default('OPTIONAL'),
  recordingEnabled: configRules.recordingEnabled.default(false),
});
export type InterviewConfig = z.infer<typeof interviewConfigSchema>;

/** Only the fields the client sent; merged over the stored (or default) config by the service. */
export const interviewConfigPatchSchema = z.object(configRules).partial();

const fields = {
  jobTitle: z.string().trim().min(1, 'Job title is required.').max(200),
  jobDescription: z.string().trim().min(30, 'Paste the job description (at least a few sentences).').max(20_000),
  requiredSkills: z.array(z.string().trim().min(1).max(80)).max(30),
  candidateName: z.string().trim().min(1, 'Candidate name is required.').max(200),
  candidateEmail: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
};

export const createInterviewSchema = z.object({
  ...fields,
  requiredSkills: fields.requiredSkills.default([]),
  config: interviewConfigPatchSchema.default({}),
});

/** PATCH /interviews/:id: omitted fields stay unchanged. */
export const updateInterviewSchema = z
  .object({
    jobTitle: fields.jobTitle.optional(),
    jobDescription: fields.jobDescription.optional(),
    requiredSkills: fields.requiredSkills.optional(),
    candidateName: fields.candidateName.optional(),
    candidateEmail: fields.candidateEmail.optional(),
    config: interviewConfigPatchSchema.optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), { message: 'Change at least one field.' });

export const listInterviewsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: interviewStatus.optional(),
});
