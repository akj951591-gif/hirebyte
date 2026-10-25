import type { Difficulty, ExperienceLevel, QuestionCategory } from '@contracts';
import { AppError } from '../../lib/errors.js';

export interface QuestionGenerationInput {
  jobTitle: string;
  jobDescription: string;
  requiredSkills: string[];
  /** Extracted resume text, or null when no resume was processed. */
  resumeText: string | null;
  count: number;
  difficulty: Difficulty;
  experienceLevel: ExperienceLevel;
  categories: QuestionCategory[];
}

export interface GeneratedQuestion {
  text: string;
  category: QuestionCategory;
  difficulty: Difficulty;
  targetSkills: string[];
  evaluationCriteria: string[];
  expectedAnswerPoints: string[];
}

export interface AnswerEvaluationInput {
  jobTitle: string;
  requiredSkills: string[];
  question: { text: string; category: QuestionCategory; difficulty: Difficulty; evaluationCriteria: string[]; expectedAnswerPoints: string[] };
  transcript: string;
}

/** Scores are out of 10, overall and per criterion. */
export interface AnswerEvaluation {
  score: number;
  criteria: Array<{ criterion: string; score: number }>;
  /** Short quotes the model says come from the transcript; the service keeps only verified ones. */
  evidence: string[];
  explanation: string;
  strengths: string[];
  gaps: string[];
}

export interface InterviewerTurnInput {
  jobTitle: string;
  question: { text: string; category: QuestionCategory };
  transcript: string;
  /** False once the follow-up limit is reached: the interviewer then only acknowledges. */
  mayAskFollowUp: boolean;
}

/** The AI interviewer's turn between questions (PRD §8.1 follow-ups). */
export interface InterviewerTurn {
  /** One or two short, neutral sentences spoken to the candidate. */
  reply: string;
  /** One short follow-up question on the same topic, or null. */
  followUp: string | null;
}

export type LlmErrorCode = 'PROVIDER_TIMEOUT' | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_AUTH' | 'PROVIDER_INVALID_RESPONSE' | 'PROVIDER_UNAVAILABLE';

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Maps a provider failure to the API's error shape: timeouts are distinct, everything else is "unavailable". */
export function providerFailure(err: LlmError): AppError {
  return err.code === 'PROVIDER_TIMEOUT' ? new AppError(504, 'PROVIDER_TIMEOUT', err.message) : new AppError(503, 'PROVIDER_UNAVAILABLE', err.message);
}

/** AI provider boundary (PRD §8.2-8.3): any OpenAI-compatible chat API; tests use a fake. */
export interface LlmProvider {
  generateQuestions(input: QuestionGenerationInput): Promise<GeneratedQuestion[]>;
  evaluateAnswer(input: AnswerEvaluationInput): Promise<AnswerEvaluation>;
  respondToAnswer(input: InterviewerTurnInput): Promise<InterviewerTurn>;
  /** The candidate asked the interviewer something; clarify without giving the answer. */
  answerCandidateQuestion(input: { jobTitle: string; question: { text: string; category: QuestionCategory }; message: string }): Promise<{ reply: string }>;
}
