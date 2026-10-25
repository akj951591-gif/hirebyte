import type * as Api from '@contracts';
import type { Env } from '../../config/env.js';
import type { Crypto } from '../../lib/crypto.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { interviewConfigSchema, type InterviewConfig } from '../../schemas/interview.schema.js';
import { rubricSchema } from '../../schemas/question.schema.js';
import { isLive } from './stateMachine.js';

/** Maps database rows to the contract DTOs (backend/contracts/api-types.ts). */

export const summaryInclude = {
  _count: { select: { questions: true } },
  evaluations: { select: { score: true, overrideScore: true } },
  recordings: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
} satisfies Prisma.InterviewInclude;

export const detailInclude = {
  ...summaryInclude,
  questions: { orderBy: { sequence: 'asc' } },
  invitation: true,
  resume: true,
  mediaSession: true,
  answers: { select: { questionId: true, status: true } },
  proctoringEvents: { orderBy: { occurredAt: 'desc' }, take: 10 },
} satisfies Prisma.InterviewInclude;

export type InterviewWithSummary = Prisma.InterviewGetPayload<{ include: typeof summaryInclude }>;
export type InterviewWithDetail = Prisma.InterviewGetPayload<{ include: typeof detailInclude }>;

export function parseConfig(raw: unknown): InterviewConfig {
  const parsed = interviewConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : interviewConfigSchema.parse({});
}

/** Average of effective scores (reviewer override wins). Unanswered questions have no evaluation. */
export function overallScore(evals: Array<{ score: number | null; overrideScore: number | null }>): number | null {
  const scores = evals.map((e) => e.overrideScore ?? e.score).filter((s): s is number => s !== null);
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toSummary(i: InterviewWithSummary): Api.InterviewSummary {
  const config = parseConfig(i.config);
  return {
    id: i.id,
    jobTitle: i.jobTitle,
    candidateName: i.candidateName,
    candidateEmail: i.candidateEmail,
    status: i.status,
    questionCount: i._count.questions || config.questionCount,
    overallScore: overallScore(i.evaluations),
    maxScore: 10,
    recordingStatus: i.recordings[0]?.status ?? 'NOT_ENABLED',
    createdAt: i.createdAt.toISOString(),
    startedAt: iso(i.startedAt),
    endedAt: iso(i.endedAt),
  };
}

export function toQuestion(q: Prisma.QuestionGetPayload<object>): Api.Question {
  const rubric = rubricSchema.safeParse(q.rubric);
  return {
    id: q.id,
    sequence: q.sequence,
    text: q.text,
    category: q.category,
    difficulty: q.difficulty,
    targetSkills: q.targetSkills,
    evaluationCriteria: rubric.success ? rubric.data.evaluationCriteria : [],
    expectedAnswerPoints: rubric.success ? rubric.data.expectedAnswerPoints : [],
    source: q.source,
  };
}

export function invitationUrl(env: Env, code: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/candidate/login?code=${encodeURIComponent(code)}`;
}

export function toInvitation(inv: Prisma.InvitationGetPayload<object>, crypto: Crypto, env: Env): Api.Invitation {
  return { code: inv.code, accessCode: crypto.decrypt(inv.accessCodeEncrypted), url: invitationUrl(env, inv.code), expiresAt: inv.expiresAt.toISOString() };
}

export function toResume(r: Prisma.ResumeGetPayload<object>): Api.ResumeInfo {
  return { id: r.id, filename: r.filename, mimeType: r.mimeType, sizeBytes: r.sizeBytes, extractionStatus: r.extractionStatus, failureCode: r.failureCode };
}

export function toProctoringEvent(e: Prisma.ProctoringEventGetPayload<object>): Api.ProctoringEvent {
  return {
    id: e.id,
    type: e.type,
    occurredAt: e.occurredAt.toISOString(),
    durationSeconds: e.durationSeconds,
    sourceCamera: e.sourceCamera,
    description: e.description,
    reviewStatus: e.reviewStatus,
    reviewerNote: e.reviewerNote,
  };
}

export function toRecording(r: Prisma.RecordingGetPayload<object>): Api.Recording {
  return {
    id: r.id,
    interviewId: r.interviewId,
    status: r.status,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
    durationSeconds: r.durationSeconds,
    startedAt: iso(r.startedAt),
    completedAt: iso(r.completedAt),
    failureCode: r.failureCode,
  };
}

export function progressOf(
  questions: Array<{ id: string; sequence: number }>,
  answers: Array<{ questionId: string; status: Api.AnswerStatus }>,
): { progress: Api.InterviewProgress; nextQuestionId: string | null } {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a.status]));
  const answered = answers.filter((a) => a.status === 'ANSWERED').length;
  const skipped = answers.filter((a) => a.status === 'SKIPPED').length;
  const next = [...questions].sort((a, b) => a.sequence - b.sequence).find((q) => !byQuestion.has(q.id)) ?? null;
  return {
    progress: { answered, skipped, total: questions.length, currentSequence: next?.sequence ?? null },
    nextQuestionId: next?.id ?? null,
  };
}

export function toDetail(i: InterviewWithDetail, crypto: Crypto, env: Env): Api.InterviewDetail {
  const live: Api.InterviewLiveState | null = isLive(i.status)
    ? {
        progress: progressOf(i.questions, i.answers).progress,
        primaryCamera: i.mediaSession?.primaryStatus ?? 'NOT_CONNECTED',
        secondaryCamera: i.mediaSession?.secondaryStatus ?? 'NOT_CONNECTED',
        recentEvents: i.proctoringEvents.map(toProctoringEvent),
        updatedAt: new Date().toISOString(),
      }
    : null;
  return {
    ...toSummary(i),
    jobDescription: i.jobDescription,
    requiredSkills: i.requiredSkills,
    config: parseConfig(i.config),
    resume: i.resume ? toResume(i.resume) : null,
    questions: i.questions.map(toQuestion),
    invitation: i.invitation ? toInvitation(i.invitation, crypto, env) : null,
    live,
  };
}

export function toConversationTurn(t: Prisma.ConversationTurnGetPayload<object>): Api.ConversationTurn {
  return { id: t.id, role: t.role, kind: t.kind, text: t.text, questionId: t.questionId, createdAt: t.createdAt.toISOString() };
}
