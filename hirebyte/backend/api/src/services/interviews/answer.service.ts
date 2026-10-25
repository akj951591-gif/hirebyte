import type * as Api from '@contracts';
import type { z } from 'zod';
import type { AppDeps } from '../../context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError, Errors } from '../../lib/errors.js';
import { logger, safeError } from '../../lib/logger.js';
import { recordAudit } from '../../repositories/auditEvent.repository.js';
import { isUniqueViolation } from '../../repositories/prisma.js';
import { LlmError, providerFailure } from '../../providers/llm/llm.types.js';
import type { askInterviewerSchema, consentSchema, proctoringEventSchema, skipQuestionSchema, submitAnswerSchema } from '../../schemas/answer.schema.js';
import type { CandidateContext } from '../auth/candidateSession.service.js';
import type { MediaService } from '../media/media.service.js';
import type { RecordingService } from '../recordings/recording.service.js';
import { parseConfig, progressOf, toConversationTurn, toProctoringEvent } from './dto.js';
import { publishQuestion, publishStatus } from '../../realtime/eventHub.js';
import {
  candidateInstructions,
  firstNameOf,
  interviewerClosing,
  interviewerGreeting,
  proctoringNotice,
  PROCTORING_NOTICE_VERSION,
  recordingNotice,
  RECORDING_NOTICE_VERSION,
} from './notices.js';
import { isFinished, isLive, isRunning, RUNNING_STATUSES, transitionInterview } from './stateMachine.js';

/** No new follow-ups when less than this is left before the time limit. */
const FOLLOW_UP_MIN_TIME_LEFT_MS = 3 * 60_000;
/** The candidate may ask the interviewer this many times per question. */
const MAX_ASKS_PER_QUESTION = 3;
const normalizeText = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Candidate-facing interview engine (PRD §8.1). Only candidate-safe data leaves this service: no
 * rubric, scores, notes or recording administration (PRD §2.1).
 */
export function createCandidateFlowService(deps: AppDeps, recordings: RecordingService, media: MediaService) {
  const { db, env, now, events, llm } = deps;

  const loadInterview = (id: string) =>
    db.interview.findUniqueOrThrow({
      where: { id },
      include: {
        questions: { orderBy: { sequence: 'asc' } },
        answers: { select: { questionId: true, status: true } },
        // The interviewer lines that lead into a question (greeting / reply), newest first.
        conversationTurns: { where: { kind: { in: ['GREETING', 'REPLY'] } }, orderBy: { createdAt: 'desc' }, select: { questionId: true, text: true } },
      },
    });
  type LoadedInterview = Awaited<ReturnType<typeof loadInterview>>;

  const addTurn = (interviewId: string, role: Api.ConversationRole, kind: Api.ConversationTurnKind, text: string, questionId: string | null, at = now()) =>
    db.conversationTurn.create({ data: { interviewId, role, kind, text, questionId, createdAt: at } });

  const latestConsent = (interviewId: string) =>
    db.consentRecord.findFirst({ where: { interviewId }, orderBy: { consentedAt: 'desc' } });

  const recordingEnabledFor = (configEnabled: boolean) => env.RECORDING_ENABLED && configEnabled;

  /** Server-side time limit: configured duration plus a short grace period for the last save. */
  function deadlineOf(interview: { startedAt: Date | null; config: unknown }): Date | null {
    if (!interview.startedAt) return null;
    const { durationMinutes } = parseConfig(interview.config);
    return new Date(interview.startedAt.getTime() + (durationMinutes + env.INTERVIEW_GRACE_MINUTES) * 60_000);
  }

  function toCurrent(interview: LoadedInterview): Api.CurrentQuestionResponse {
    const config = parseConfig(interview.config);
    const { progress, nextQuestionId } = progressOf(interview.questions, interview.answers);
    const next = interview.questions.find((q) => q.id === nextQuestionId);
    const running = isRunning(interview.status);
    return {
      status: interview.status,
      question: running && next ? { id: next.id, sequence: next.sequence, text: next.text, category: next.category, isFollowUp: next.source === 'FOLLOW_UP' } : null,
      progress,
      startedAt: interview.startedAt?.toISOString() ?? null,
      durationMinutes: config.durationMinutes,
      allowSkip: config.allowSkip,
      // What the interviewer said leading into this question, so a refresh shows (and speaks) it again.
      interviewerReply: running && next ? (interview.conversationTurns.find((t) => t.questionId === next.id)?.text ?? null) : null,
    };
  }

  /** Inserts a follow-up right after `after`, shifting later questions down by one. */
  async function insertFollowUp(interviewId: string, after: LoadedInterview['questions'][number], parentQuestionId: string, text: string) {
    await db.$transaction(async (tx) => {
      // Two steps (negate, then flip back) so the unique (interviewId, sequence) never clashes midway.
      await tx.$executeRaw`UPDATE "Question" SET "sequence" = -("sequence" + 1) WHERE "interviewId" = ${interviewId}::uuid AND "sequence" > ${after.sequence}`;
      await tx.$executeRaw`UPDATE "Question" SET "sequence" = -"sequence" WHERE "interviewId" = ${interviewId}::uuid AND "sequence" < 0`;
      await tx.question.create({
        data: {
          interviewId,
          sequence: after.sequence + 1,
          text,
          category: after.category,
          difficulty: after.difficulty,
          targetSkills: after.targetSkills,
          // Scored against the original question's rubric.
          rubric: after.rubric as Prisma.InputJsonValue,
          source: 'FOLLOW_UP',
          parentQuestionId,
        },
      });
    });
  }

  /**
   * The AI interviewer's turn after an answer: a short neutral reply and, within the configured
   * limits, one follow-up question. Any failure just means no reply: the interview never waits.
   */
  async function interviewerTurn(interview: LoadedInterview, questionId: string, transcript: string): Promise<string | null> {
    if (!llm) return null;
    const question = interview.questions.find((q) => q.id === questionId);
    if (!question) return null;
    const config = parseConfig(interview.config);
    const rootId = question.parentQuestionId ?? question.id;
    const followUpsSoFar = interview.questions.filter((q) => q.parentQuestionId === rootId).length;
    const deadline = deadlineOf(interview);
    const enoughTime = !deadline || deadline.getTime() - now().getTime() > FOLLOW_UP_MIN_TIME_LEFT_MS;
    const mayAskFollowUp = config.allowFollowUps && followUpsSoFar < config.maxFollowUps && enoughTime;

    let turn;
    try {
      turn = await llm.respondToAnswer({ jobTitle: interview.jobTitle, question: { text: question.text, category: question.category }, transcript, mayAskFollowUp });
    } catch (err) {
      logger.warn('interviewer reply skipped', { interviewId: interview.id, ...safeError(err) });
      return null;
    }
    const followUp = mayAskFollowUp ? turn.followUp?.trim() : null;
    const known = new Set(interview.questions.map((q) => normalizeText(q.text)));
    if (followUp && !known.has(normalizeText(followUp))) {
      await insertFollowUp(interview.id, question, rootId, followUp);
      await recordAudit(db, { actorRole: 'SYSTEM', action: 'interview.follow_up_asked', resourceType: 'interview', resourceId: interview.id, metadata: { parentQuestionId: rootId } });
    }
    return turn.reply;
  }

  /** Marks every open question UNANSWERED (never discarding saved answers) and completes the interview. */
  async function completeInternal(interviewId: string, reason: 'candidate' | 'time_limit'): Promise<boolean> {
    const changed = await db.$transaction(async (tx) => {
      const open = await tx.question.findMany({ where: { interviewId, answer: { is: null } }, select: { id: true } });
      if (open.length) {
        await tx.answer.createMany({
          data: open.map((q) => ({ interviewId, questionId: q.id, status: 'UNANSWERED' as const })),
          skipDuplicates: true,
        });
      }
      return transitionInterview(tx, interviewId, RUNNING_STATUSES, 'COMPLETED', { endedAt: now() });
    });
    if (changed) {
      publishStatus(events, interviewId, 'COMPLETED', now());
      const { candidateName } = await db.interview.findUniqueOrThrow({ where: { id: interviewId }, select: { candidateName: true } });
      await addTurn(interviewId, 'INTERVIEWER', 'CLOSING', interviewerClosing(firstNameOf(candidateName)), null);
      await recordAudit(db, { actorRole: reason === 'candidate' ? 'CANDIDATE' : 'SYSTEM', action: 'interview.completed', resourceType: 'interview', resourceId: interviewId, metadata: { reason } });
      await recordings.finalizeForInterview(interviewId);
    }
    return changed;
  }

  /** Enforces the duration on the server (PRD §8.1): past the grace period the interview is submitted. */
  async function finishIfOverTime(interview: LoadedInterview): Promise<LoadedInterview> {
    const deadline = deadlineOf(interview);
    if (!deadline || !isRunning(interview.status) || now() <= deadline) return interview;
    await completeInternal(interview.id, 'time_limit');
    return loadInterview(interview.id);
  }

  async function saveResponse(
    ctx: CandidateContext,
    kind: 'answer' | 'skip',
    body: z.infer<typeof submitAnswerSchema> | z.infer<typeof skipQuestionSchema>,
  ): Promise<Api.CurrentQuestionResponse> {
    // Same idempotency key = the same submission retried: return the saved state, never a duplicate.
    const replay = await db.answer.findUnique({ where: { idempotencyKey: body.idempotencyKey }, select: { interviewId: true } });
    if (replay) {
      if (replay.interviewId !== ctx.interviewId) throw Errors.conflict('This submission key was already used.');
      return toCurrent(await loadInterview(ctx.interviewId));
    }

    let interview = await loadInterview(ctx.interviewId);
    if (!isRunning(interview.status)) {
      throw Errors.conflict(isFinished(interview.status) ? 'This interview has already been submitted.' : 'The interview has not started yet.');
    }
    interview = await finishIfOverTime(interview);
    if (isFinished(interview.status)) {
      throw Errors.conflict('Time is up. The interview was submitted with the answers you had saved.');
    }

    const config = parseConfig(interview.config);
    const { nextQuestionId } = progressOf(interview.questions, interview.answers);
    if (body.questionId !== nextQuestionId) {
      const alreadySaved = interview.answers.some((a) => a.questionId === body.questionId);
      if (alreadySaved) throw new AppError(409, 'DUPLICATE_SUBMISSION', 'This question already has a saved answer.');
      throw Errors.conflict('That is not the current question. Reloading the latest state.');
    }
    if (kind === 'skip' && !config.allowSkip) throw new AppError(403, 'SKIP_NOT_ALLOWED', 'Skipping is not enabled for this interview.');

    const answer = kind === 'answer' ? (body as z.infer<typeof submitAnswerSchema>) : null;
    if (answer && !answer.transcript.trim()) {
      throw Errors.validation('Your answer is empty. Record or type an answer first, or skip the question.');
    }

    let saved = false;
    try {
      await db.answer.create({
        data: {
          interviewId: interview.id,
          questionId: body.questionId,
          status: answer ? 'ANSWERED' : 'SKIPPED',
          transcript: answer ? answer.transcript.trim() : '',
          durationSeconds: answer ? answer.durationSeconds : null,
          inputMode: answer ? answer.inputMode : null,
          idempotencyKey: body.idempotencyKey,
          submittedAt: now(),
        },
      });
      saved = true;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Lost a race with a retry of the same request (same key) or with another tab (same question).
      const sameKey = await db.answer.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
      if (!sameKey) throw new AppError(409, 'DUPLICATE_SUBMISSION', 'This question already has a saved answer.');
    }
    // The AI interviewer reacts to a spoken or typed answer (not to a skip).
    const interviewerReply = saved && answer ? await interviewerTurn(interview, body.questionId, answer.transcript.trim()) : null;
    let after = await loadInterview(interview.id);
    if (interviewerReply) {
      // Stored against the question it leads into (none after the last one).
      await addTurn(interview.id, 'INTERVIEWER', 'REPLY', interviewerReply, progressOf(after.questions, after.answers).nextQuestionId);
      after = await loadInterview(interview.id);
    }
    const result = { ...toCurrent(after), interviewerReply };
    if (saved) {
      const at = now();
      events.publish('answer.saved', { interviewId: interview.id, questionId: body.questionId, status: answer ? 'ANSWERED' : 'SKIPPED', timestamp: at.toISOString() });
      publishQuestion(events, interview.id, result.question, at);
    }
    return result;
  }

  /** Observations are for a human reviewer, never a verdict (PRD §13); only accepted while the interview runs. */
  async function recordObservation(interviewId: string, body: z.infer<typeof proctoringEventSchema>, sourceCamera: Api.CameraSource): Promise<Api.ProctoringEvent> {
    const interview = await db.interview.findUniqueOrThrow({ where: { id: interviewId }, select: { status: true } });
    if (!isRunning(interview.status)) throw Errors.conflict('Observations can only be logged during the interview.');
    const defaults: Record<string, string> = {
      FACE_ABSENT: 'No face detected in the camera.',
      MULTIPLE_FACES: 'More than one face detected in the camera.',
      LOOKING_AWAY: 'Candidate looked away from the screen.',
      TAB_HIDDEN: 'The interview tab was hidden.',
      AUDIO_ISSUE: 'Microphone audio was interrupted.',
    };
    const event = await db.proctoringEvent.create({
      data: {
        interviewId,
        type: body.type,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : now(),
        durationSeconds: body.durationSeconds ?? null,
        sourceCamera,
        description: body.description || defaults[body.type],
      },
    });
    events.publish('proctoring.event_created', {
      interviewId,
      eventId: event.id,
      type: event.type,
      sourceCamera: event.sourceCamera,
      timestamp: event.occurredAt.toISOString(),
    });
    return toProctoringEvent(event);
  }

  return {
    /**
     * Completes running interviews whose time limit has passed, even if the candidate closed the tab
     * and never calls the API again (PRD §8.1). Run periodically by the server; returns how many ended.
     */
    async expireOverdue(): Promise<number> {
      const running = await db.interview.findMany({
        where: { status: { in: [...RUNNING_STATUSES] }, startedAt: { not: null } },
        select: { id: true, startedAt: true, config: true },
      });
      let expired = 0;
      for (const interview of running) {
        const deadline = deadlineOf(interview);
        if (deadline && now() > deadline && (await completeInternal(interview.id, 'time_limit'))) expired += 1;
      }
      return expired;
    },

    async view(ctx: CandidateContext): Promise<Api.CandidateSessionView> {
      const [interview, session, consent] = await Promise.all([
        db.interview.findUniqueOrThrow({ where: { id: ctx.interviewId }, include: { _count: { select: { questions: true } } } }),
        db.candidateSession.findUniqueOrThrow({ where: { id: ctx.sessionId } }),
        latestConsent(ctx.interviewId),
      ]);
      const config = parseConfig(interview.config);
      // Without LiveKit there is no phone camera to pair, so the candidate is not asked to.
      const secondaryCamera: Api.SecondaryCameraPolicy = env.livekitConfigured ? config.secondaryCamera : 'OFF';
      return {
        sessionId: ctx.sessionId,
        interviewId: interview.id,
        status: interview.status,
        candidateName: interview.candidateName.split(/\s+/)[0] ?? interview.candidateName,
        jobTitle: interview.jobTitle,
        companyName: env.COMPANY_NAME,
        estimatedDurationMinutes: config.durationMinutes,
        questionCount: interview._count.questions,
        allowSkip: config.allowSkip,
        instructions: candidateInstructions(config),
        recording: recordingNotice(env, config, recordingEnabledFor(config.recordingEnabled)),
        proctoring: proctoringNotice,
        secondaryCamera,
        consent: consent
          ? { recordingConsent: consent.recordingConsent, proctoringConsent: consent.proctoringConsent, consentedAt: consent.consentedAt.toISOString() }
          : null,
        pairing: isLive(interview.status) ? await media.pairingFor(interview.id, secondaryCamera) : null,
        expiresAt: session.expiresAt.toISOString(),
      };
    },

    async consent(ctx: CandidateContext, body: z.infer<typeof consentSchema>): Promise<Api.ConsentResponse> {
      const interview = await db.interview.findUniqueOrThrow({ where: { id: ctx.interviewId } });
      if (interview.status !== 'ONBOARDING') throw Errors.conflict('Consent can only be changed before the interview starts.');
      if (body.recordingNoticeVersion !== RECORDING_NOTICE_VERSION || body.proctoringNoticeVersion !== PROCTORING_NOTICE_VERSION) {
        throw Errors.validation('The notice was updated. Please reload the page and review it again.');
      }
      if (!body.proctoringConsent) {
        throw new AppError(400, 'CONSENT_REQUIRED', 'Consent to the observation notice is required to take this interview.');
      }
      const recordingEnabled = recordingEnabledFor(parseConfig(interview.config).recordingEnabled);
      const record = await db.consentRecord.create({
        data: {
          interviewId: interview.id,
          candidateSessionId: ctx.sessionId,
          recordingConsent: recordingEnabled && body.recordingConsent,
          proctoringConsent: true,
          recordingNoticeVersion: body.recordingNoticeVersion,
          proctoringNoticeVersion: body.proctoringNoticeVersion,
          recordingEnabled,
          // Evidence of exactly which feeds the candidate agreed to have recorded (PRD §4.1).
          recordedFeeds: recordingEnabled && body.recordingConsent ? recordingNotice(env, parseConfig(interview.config), true).feeds : [],
        },
      });
      await recordAudit(db, { actorId: ctx.sessionId, actorRole: 'CANDIDATE', action: 'candidate.consent', resourceType: 'interview', resourceId: interview.id, metadata: { recordingConsent: record.recordingConsent } });
      return { consent: { recordingConsent: record.recordingConsent, proctoringConsent: true, consentedAt: record.consentedAt.toISOString() } };
    },

    async start(ctx: CandidateContext): Promise<Api.CurrentQuestionResponse> {
      const interview = await loadInterview(ctx.interviewId);
      if (isRunning(interview.status)) return toCurrent(await finishIfOverTime(interview));
      if (isFinished(interview.status)) throw new AppError(409, 'INTERVIEW_COMPLETED', 'This interview has already been completed.');
      if (interview.status !== 'ONBOARDING') throw Errors.conflict('This interview cannot be started right now.');
      if (interview.questions.length === 0) throw Errors.conflict('This interview has no questions yet. Please contact the recruiter.');

      const consent = await latestConsent(interview.id);
      if (!consent) throw new AppError(400, 'CONSENT_REQUIRED', 'Please review the notice and give consent first.');
      const config = parseConfig(interview.config);
      if (config.secondaryCamera === 'REQUIRED' && env.livekitConfigured) {
        const mediaSession = await db.mediaSession.findUnique({ where: { interviewId: interview.id } });
        if (mediaSession?.phoneStatus !== 'PAIRED') {
          throw new AppError(409, 'SECONDARY_CAMERA_REQUIRED', 'Connect your phone camera before starting.');
        }
      }

      const started = await transitionInterview(db, interview.id, 'ONBOARDING', 'IN_PROGRESS', { startedAt: now() });
      if (started) {
        publishStatus(events, interview.id, 'IN_PROGRESS', now());
        await recordAudit(db, { actorId: ctx.sessionId, actorRole: 'CANDIDATE', action: 'interview.started', resourceType: 'interview', resourceId: interview.id });
        // Recording starts only when enabled by policy, requested by the recruiter and consented to (PRD §9.2).
        if (recordingEnabledFor(config.recordingEnabled) && consent.recordingConsent) {
          await recordings.startForInterview(interview.id, consent.id);
        }
      }
      let result = toCurrent(await loadInterview(interview.id));
      if (started) {
        if (result.question) {
          const greeting = interviewerGreeting({
            firstName: firstNameOf(interview.candidateName),
            jobTitle: interview.jobTitle,
            company: env.COMPANY_NAME,
            questionCount: interview.questions.length,
            followUps: config.allowFollowUps && config.maxFollowUps > 0,
          });
          await addTurn(interview.id, 'INTERVIEWER', 'GREETING', greeting, result.question.id);
          result = { ...result, interviewerReply: greeting };
        }
        publishQuestion(events, interview.id, result.question, now());
      }
      return result;
    },

    async current(ctx: CandidateContext): Promise<Api.CurrentQuestionResponse> {
      return toCurrent(await finishIfOverTime(await loadInterview(ctx.interviewId)));
    },

    submitAnswer: (ctx: CandidateContext, body: z.infer<typeof submitAnswerSchema>) => saveResponse(ctx, 'answer', body),
    skip: (ctx: CandidateContext, body: z.infer<typeof skipQuestionSchema>) => saveResponse(ctx, 'skip', body),

    async complete(ctx: CandidateContext): Promise<Api.CompleteSessionResponse> {
      let interview = await loadInterview(ctx.interviewId);
      if (isRunning(interview.status)) {
        await completeInternal(interview.id, 'candidate');
        interview = await loadInterview(interview.id);
      } else if (!isFinished(interview.status)) {
        throw Errors.conflict('The interview has not started yet.');
      }
      const closing = await db.conversationTurn.findFirst({ where: { interviewId: interview.id, kind: 'CLOSING' }, orderBy: { createdAt: 'desc' } });
      return {
        status: interview.status,
        submittedAt: (interview.endedAt ?? now()).toISOString(),
        progress: progressOf(interview.questions, interview.answers).progress,
        closingMessage: closing?.text ?? interviewerClosing(firstNameOf(interview.candidateName)),
      };
    },

    /** The whole conversation so far (candidate-safe: only what was said to and by the candidate). */
    async conversation(ctx: CandidateContext): Promise<Api.ConversationResponse> {
      const turns = await db.conversationTurn.findMany({ where: { interviewId: ctx.interviewId }, orderBy: { createdAt: 'asc' } });
      return { turns: turns.map(toConversationTurn) };
    },

    /**
     * The candidate asks the interviewer about the current question. The AI may rephrase or explain
     * it but never gives the answer; both lines are kept for the recruiter to review.
     */
    async ask(ctx: CandidateContext, body: z.infer<typeof askInterviewerSchema>): Promise<Api.AskInterviewerResponse> {
      const interview = await loadInterview(ctx.interviewId);
      if (!isRunning(interview.status)) throw Errors.conflict('You can ask the interviewer something while the interview is running.');
      const { nextQuestionId } = progressOf(interview.questions, interview.answers);
      const question = interview.questions.find((q) => q.id === nextQuestionId);
      if (!question || question.id !== body.questionId) throw Errors.conflict('You can only ask about the current question.');
      if (!llm) throw Errors.notConfigured('PROVIDER_UNAVAILABLE', 'The interviewer cannot take questions right now. Please answer as best you can.');
      const asked = await db.conversationTurn.count({ where: { interviewId: interview.id, questionId: question.id, kind: 'CLARIFICATION_REQUEST' } });
      if (asked >= MAX_ASKS_PER_QUESTION) {
        throw Errors.conflict(`You can ask up to ${MAX_ASKS_PER_QUESTION} questions about each interview question. Please answer as best you can.`);
      }

      let reply: string;
      try {
        ({ reply } = await llm.answerCandidateQuestion({ jobTitle: interview.jobTitle, question: { text: question.text, category: question.category }, message: body.message }));
      } catch (err) {
        if (err instanceof LlmError) throw providerFailure(err);
        throw err;
      }
      // Saved only once answered, so a failed attempt does not count against the limit.
      const at = now();
      const request = await addTurn(interview.id, 'CANDIDATE', 'CLARIFICATION_REQUEST', body.message, question.id, at);
      const answerTurn = await addTurn(interview.id, 'INTERVIEWER', 'CLARIFICATION', reply, question.id, new Date(at.getTime() + 1));
      return { question: toConversationTurn(request), reply: toConversationTurn(answerTurn) };
    },

    /** Candidate laptop observation (camera or tab checks). Stored for human review only. */
    async logEvent(ctx: CandidateContext, interviewId: string, body: z.infer<typeof proctoringEventSchema>): Promise<Api.ProctoringEvent> {
      if (ctx.interviewId !== interviewId) throw Errors.forbidden();
      return recordObservation(interviewId, body, body.sourceCamera);
    },

    /** Paired phone observation (e.g. another person in view), authorised by the phone's device token. */
    async logPhoneEvent(interviewId: string, deviceToken: string, body: z.infer<typeof proctoringEventSchema>): Promise<Api.ProctoringEvent> {
      await media.verifyPhone(interviewId, deviceToken);
      return recordObservation(interviewId, body, 'SECONDARY');
    },
  };
}

export type CandidateFlowService = ReturnType<typeof createCandidateFlowService>;
