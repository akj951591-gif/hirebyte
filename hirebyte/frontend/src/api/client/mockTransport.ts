/**
 * FIXTURE TRANSPORT — isolated UI development only (PRD §6.1.6).
 *
 * Answers the typed API client in the browser using fixtures.ts, mimicking the provisional
 * contract (status codes, error bodies, auth checks) so every UI state can be exercised without
 * the backend. It is loaded only when VITE_USE_FIXTURES=true. State lives in localStorage so a
 * recruiter tab and a candidate tab in the same browser see the same fixture data.
 */
import type {
  CandidateSessionView,
  CreateInterviewRequest,
  CurrentQuestionResponse,
  Evaluation,
  InterviewDetail,
  InterviewStatus,
  InterviewSummary,
  ListInterviewsResponse,
  ProctoringEvent,
  QuestionDraft,
  ReviewEvaluationRequest,
  ReviewProctoringEventRequest,
  UpdateInterviewRequest,
} from '../generated/contract';
import {
  FIXTURE_RECRUITER,
  FIXTURE_RECRUITER_PASSWORD,
  FIXTURE_SPECIAL_CODES,
  PROCTORING_NOTICE_VERSION,
  RECORDING_NOTICE_VERSION,
  createSeedState,
  fixtureEvaluation,
  fixtureId,
  generateFixtureQuestions,
  overallFrom,
  toCandidateQuestion,
  type FixtureSession,
  type FixtureState,
} from './fixtures';
import { ApiError, type RequestOptions, type Transport } from './http';

const STORAGE_KEY = 'hirebyte.fixtures';
const MAX_LOGIN_FAILURES = 5;
const EVALUATION_FIXTURE_DELAY_MS = 4000;

let memoryState: FixtureState | null = null;

function load(): FixtureState {
  if (memoryState) return memoryState;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FixtureState;
      if (parsed.version === 3) return (memoryState = parsed);
    }
  } catch {
    // storage unavailable or corrupt — fall back to fresh seed data
  }
  return (memoryState = createSeedState());
}

function save(state: FixtureState) {
  memoryState = state;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore: fixture data simply won't survive a reload
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) memoryState = null;
  });
}

function fail(status: number, code: string, message: string, details?: Record<string, unknown>): never {
  throw new ApiError(code, message, status, `fixture-${Math.random().toString(36).slice(2, 10)}`, details);
}

const now = () => new Date().toISOString();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LIVE_STATUSES: InterviewStatus[] = ['ONBOARDING', 'IN_PROGRESS', 'PROCESSING_ANSWER'];
const DONE_STATUSES: InterviewStatus[] = ['COMPLETED', 'EVALUATING', 'EVALUATED', 'EVALUATION_FAILED', 'REVIEWED'];

function summary(i: InterviewDetail): InterviewSummary {
  return {
    id: i.id,
    jobTitle: i.jobTitle,
    candidateName: i.candidateName,
    candidateEmail: i.candidateEmail,
    status: i.status,
    questionCount: i.questionCount,
    overallScore: i.overallScore,
    maxScore: i.maxScore,
    recordingStatus: i.recordingStatus,
    createdAt: i.createdAt,
    startedAt: i.startedAt,
    endedAt: i.endedAt,
  };
}

function requireRecruiter(state: FixtureState) {
  if (!state.recruiterSignedIn) fail(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
}

function findInterview(state: FixtureState, id: string): InterviewDetail {
  const interview = state.interviews.find((i) => i.id === id);
  if (!interview) return fail(404, 'NOT_FOUND', 'Interview not found.');
  return interview;
}

function requireCandidate(state: FixtureState, sessionId: string): { session: FixtureSession; interview: InterviewDetail } {
  if (!state.candidateSessionId) fail(401, 'SESSION_EXPIRED', 'Your interview session has ended. Please sign in again.');
  if (state.candidateSessionId !== sessionId) fail(403, 'FORBIDDEN', 'This session does not belong to you.');
  const session = state.sessions[sessionId];
  if (!session) return fail(401, 'SESSION_EXPIRED', 'Your interview session has ended. Please sign in again.');
  return { session, interview: findInterview(state, session.interviewId) };
}

function progressOf(state: FixtureState, interview: InterviewDetail) {
  const answers = state.answers[interview.id] ?? {};
  const answered = Object.values(answers).filter((a) => a.status === 'ANSWERED').length;
  const skipped = Object.values(answers).filter((a) => a.status === 'SKIPPED').length;
  const next = interview.questions.find((q) => !answers[q.id]);
  return {
    progress: { answered, skipped, total: interview.questions.length, currentSequence: next?.sequence ?? null },
    next,
  };
}

function currentQuestion(state: FixtureState, interview: InterviewDetail): CurrentQuestionResponse {
  const { progress, next } = progressOf(state, interview);
  return {
    status: interview.status,
    question: next && LIVE_STATUSES.includes(interview.status) ? toCandidateQuestion(next) : null,
    progress,
    startedAt: interview.startedAt,
    durationMinutes: interview.config.durationMinutes,
    allowSkip: interview.config.allowSkip,
  };
}

function refreshLive(state: FixtureState, interview: InterviewDetail, session?: FixtureSession) {
  if (!LIVE_STATUSES.includes(interview.status)) {
    interview.live = null;
    return;
  }
  const { progress } = progressOf(state, interview);
  interview.live = {
    progress,
    primaryCamera: interview.status === 'IN_PROGRESS' ? 'CONNECTED' : 'CONNECTING',
    secondaryCamera:
      interview.config.secondaryCamera === 'OFF'
        ? 'NOT_CONNECTED'
        : session?.pairingStatus === 'PAIRED' || interview.live?.secondaryCamera === 'CONNECTED'
          ? 'CONNECTED'
          : 'NOT_CONNECTED',
    recentEvents: (state.events[interview.id] ?? []).slice(-10),
    updatedAt: now(),
  };
}

function sessionView(session: FixtureSession, interview: InterviewDetail): CandidateSessionView {
  const recordingEnabled = interview.config.recordingEnabled;
  return {
    sessionId: session.sessionId,
    interviewId: interview.id,
    status: interview.status,
    candidateName: interview.candidateName.split(' ')[0],
    jobTitle: interview.jobTitle,
    companyName: 'HireByte Demo Co.',
    estimatedDurationMinutes: interview.config.durationMinutes,
    questionCount: interview.questions.length,
    allowSkip: interview.config.allowSkip,
    instructions: [
      'Find a quiet, well-lit place and close other apps that use your camera or microphone.',
      'Each question is read aloud and shown on screen. Answer out loud; you can type instead if speech recognition is unavailable.',
      'Your answer is saved before the next question appears. If you refresh, you continue where you left off.',
      interview.config.allowSkip
        ? 'You may skip a question, but skipped questions are marked as unanswered.'
        : 'Skipping questions is not enabled for this interview.',
    ],
    recording: {
      enabled: recordingEnabled,
      required: false,
      noticeVersion: RECORDING_NOTICE_VERSION,
      feeds: recordingEnabled
        ? ['Laptop camera video', 'Microphone audio', ...(interview.config.secondaryCamera !== 'OFF' ? ['Phone camera video (if paired)'] : [])]
        : [],
      purpose: 'So the hiring team can review your answers accurately after the interview.',
      access: 'Only recruiters assigned to this role can watch the recording.',
      retention: 'Recordings are deleted automatically after the configured retention period (fixture: 30 days).',
    },
    proctoring: {
      enabled: true,
      noticeVersion: PROCTORING_NOTICE_VERSION,
      description:
        'We note observable events such as your face leaving the camera view or the phone camera disconnecting. These are observations for a human reviewer, never an automatic decision.',
    },
    secondaryCamera: interview.config.secondaryCamera,
    consent: session.consent,
    pairing:
      interview.config.secondaryCamera === 'OFF'
        ? null
        : {
            url: `${window.location.origin}/pair/FIXTURE-${session.sessionId.slice(-6).toUpperCase()}`,
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            status: session.pairingStatus,
          },
    expiresAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
  };
}

function statsOf(items: InterviewSummary[]) {
  return {
    total: items.length,
    inProgress: items.filter((i) => LIVE_STATUSES.includes(i.status)).length,
    completed: items.filter((i) => DONE_STATUSES.includes(i.status)).length,
    pendingReview: items.filter((i) => ['COMPLETED', 'EVALUATING', 'EVALUATED', 'EVALUATION_FAILED'].includes(i.status)).length,
  };
}

function applyEvaluationProgress(state: FixtureState, interview: InterviewDetail) {
  const ev = state.evaluation[interview.id];
  if (ev?.status !== 'EVALUATING' || !ev.requestedAt) return;
  if (Date.now() - ev.requestedAt < EVALUATION_FIXTURE_DELAY_MS) return;
  const answers = state.answers[interview.id] ?? {};
  const evaluations: Record<string, Evaluation> = {};
  interview.questions.forEach((q) => {
    const a = answers[q.id];
    if (!a || a.status !== 'ANSWERED') return;
    // FIXTURE scoring: transcript length heuristic. Real scoring comes from the Grok adapter.
    const words = a.transcript.trim().split(/\s+/).length;
    evaluations[q.id] = fixtureEvaluation(q, a.transcript, Math.max(3, Math.min(9, Math.round(words / 6))));
  });
  state.evaluations[interview.id] = evaluations;
  state.overall[interview.id] = overallFrom(Object.values(evaluations));
  state.evaluation[interview.id] = { status: 'EVALUATED', failureCode: null, requestedAt: null };
  interview.status = 'EVALUATED';
  interview.overallScore = state.overall[interview.id]?.score ?? null;
}

type Handler = (ctx: { state: FixtureState; params: string[]; body: unknown; query: RequestOptions['query'] }) => unknown;

const routes: Array<[RequestOptions['method'], RegExp, Handler]> = [
  // ----------------------------------------------------------------------------- auth
  [
    'POST',
    /^\/auth\/recruiter\/login$/,
    ({ state, body }) => {
      const { email, password } = (body ?? {}) as { email?: string; password?: string };
      if (state.failedRecruiterLogins >= MAX_LOGIN_FAILURES) {
        fail(429, 'RATE_LIMITED', 'Too many sign-in attempts. Please wait a few minutes and try again.', {
          retryAfterSeconds: 300,
        });
      }
      if (!email || !password) fail(400, 'VALIDATION_ERROR', 'Email and password are required.');
      if (email!.trim().toLowerCase() !== FIXTURE_RECRUITER.email || password !== FIXTURE_RECRUITER_PASSWORD) {
        state.failedRecruiterLogins += 1;
        save(state);
        fail(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }
      state.recruiterSignedIn = true;
      state.failedRecruiterLogins = 0;
      save(state);
      return { user: FIXTURE_RECRUITER };
    },
  ],
  [
    'POST',
    /^\/auth\/recruiter\/logout$/,
    ({ state }) => {
      state.recruiterSignedIn = false;
      save(state);
      return undefined;
    },
  ],
  [
    'GET',
    /^\/auth\/me$/,
    ({ state }) => {
      requireRecruiter(state);
      return { user: FIXTURE_RECRUITER };
    },
  ],

  // ----------------------------------------------------------------------------- candidate
  [
    'POST',
    /^\/candidate\/access$/,
    ({ state, body }) => {
      const { invitationCode = '', accessCode = '' } = (body ?? {}) as { invitationCode?: string; accessCode?: string };
      const code = invitationCode.trim().toUpperCase();
      if (!code || !accessCode.trim()) fail(400, 'VALIDATION_ERROR', 'Enter your invitation code and access code.');
      if (state.failedAccessAttempts >= MAX_LOGIN_FAILURES) {
        fail(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.', { retryAfterSeconds: 300 });
      }
      const special = FIXTURE_SPECIAL_CODES[code];
      if (special) fail(special.status, special.code, special.message);

      const interview = state.interviews.find((i) => i.invitation?.code.toUpperCase() === code);
      if (!interview || interview.invitation?.accessCode !== accessCode.trim()) {
        state.failedAccessAttempts += 1;
        save(state);
        fail(401, 'INVITATION_INVALID', 'We could not find an interview for that invitation and access code.');
      }
      if (DONE_STATUSES.includes(interview!.status)) {
        fail(409, 'INTERVIEW_COMPLETED', 'This interview has already been completed.');
      }
      if (interview!.status === 'CANCELLED' || interview!.status === 'DRAFT') {
        fail(410, 'INVITATION_EXPIRED', 'This invitation is no longer active.');
      }
      let session = Object.values(state.sessions).find((s) => s.interviewId === interview!.id);
      if (!session) {
        session = {
          sessionId: fixtureId('cs'),
          interviewId: interview!.id,
          consent: null,
          pairingStatus: 'NOT_PAIRED',
          submittedKeys: [],
          completedAt: null,
        };
        state.sessions[session.sessionId] = session;
      }
      if (interview!.status === 'READY') interview!.status = 'ONBOARDING';
      refreshLive(state, interview!, session);
      state.candidateSessionId = session.sessionId;
      state.failedAccessAttempts = 0;
      save(state);
      return { sessionId: session.sessionId, expiresAt: new Date(Date.now() + 2 * 3_600_000).toISOString() };
    },
  ],
  [
    'POST',
    /^\/candidate\/logout$/,
    ({ state }) => {
      state.candidateSessionId = null;
      save(state);
      return undefined;
    },
  ],
  [
    'GET',
    /^\/candidate\/sessions\/([^/]+)$/,
    ({ state, params }) => {
      const { session, interview } = requireCandidate(state, params[0]);
      return sessionView(session, interview);
    },
  ],
  [
    'POST',
    /^\/candidate\/sessions\/([^/]+)\/consent$/,
    ({ state, params, body }) => {
      const { session, interview } = requireCandidate(state, params[0]);
      const req = (body ?? {}) as { recordingConsent?: boolean; proctoringConsent?: boolean };
      if (!req.proctoringConsent) {
        fail(400, 'CONSENT_REQUIRED', 'Consent to proctoring observations is required to take this interview.');
      }
      session.consent = {
        recordingConsent: interview.config.recordingEnabled ? Boolean(req.recordingConsent) : false,
        proctoringConsent: true,
        consentedAt: now(),
      };
      save(state);
      return { consent: session.consent };
    },
  ],
  [
    'POST',
    /^\/candidate\/sessions\/([^/]+)\/start$/,
    ({ state, params }) => {
      const { session, interview } = requireCandidate(state, params[0]);
      if (LIVE_STATUSES.includes(interview.status) && interview.status !== 'ONBOARDING') {
        return currentQuestion(state, interview); // already started: idempotent
      }
      if (DONE_STATUSES.includes(interview.status)) fail(409, 'INTERVIEW_COMPLETED', 'This interview has already been completed.');
      if (!session.consent) fail(400, 'CONSENT_REQUIRED', 'Please review the notice and give consent first.');
      if (interview.config.secondaryCamera === 'REQUIRED' && session.pairingStatus !== 'PAIRED') {
        fail(409, 'SECONDARY_CAMERA_REQUIRED', 'Connect your phone camera before starting.');
      }
      interview.status = 'IN_PROGRESS';
      interview.startedAt = now();
      const recordOk = interview.config.recordingEnabled && session.consent!.recordingConsent;
      interview.recordingStatus = recordOk ? 'RECORDING' : 'NOT_ENABLED';
      state.recordings[interview.id] = recordOk
        ? [
            {
              id: `rec_${interview.id}`,
              interviewId: interview.id,
              status: 'RECORDING',
              mimeType: null,
              sizeBytes: null,
              durationSeconds: null,
              startedAt: now(),
              completedAt: null,
              failureCode: null,
            },
          ]
        : [];
      refreshLive(state, interview, session);
      save(state);
      return currentQuestion(state, interview);
    },
  ],
  [
    'GET',
    /^\/candidate\/sessions\/([^/]+)\/current-question$/,
    ({ state, params }) => {
      const { interview } = requireCandidate(state, params[0]);
      return currentQuestion(state, interview);
    },
  ],
  [
    'POST',
    /^\/candidate\/sessions\/([^/]+)\/(answers|skip)$/,
    ({ state, params, body }) => {
      const { session, interview } = requireCandidate(state, params[0]);
      const isSkip = params[1] === 'skip';
      const req = (body ?? {}) as { questionId?: string; transcript?: string; durationSeconds?: number; inputMode?: 'VOICE' | 'TEXT'; idempotencyKey?: string };
      if (!req.idempotencyKey || !req.questionId) fail(400, 'VALIDATION_ERROR', 'questionId and idempotencyKey are required.');
      if (session.submittedKeys.includes(req.idempotencyKey!)) return currentQuestion(state, interview);
      if (interview.status !== 'IN_PROGRESS') fail(409, 'CONFLICT', 'The interview is not in progress.');
      const answers = (state.answers[interview.id] ??= {});
      if (answers[req.questionId!]) fail(409, 'DUPLICATE_SUBMISSION', 'This question already has a saved answer.');
      const { next } = progressOf(state, interview);
      if (!next || next.id !== req.questionId) fail(409, 'CONFLICT', 'That is not the current question. Reloading the latest state.');
      if (isSkip && !interview.config.allowSkip) fail(403, 'SKIP_NOT_ALLOWED', 'Skipping is not enabled for this interview.');
      if (!isSkip && !req.transcript?.trim()) fail(400, 'VALIDATION_ERROR', 'Your answer is empty. Record or type an answer first.');
      answers[req.questionId!] = {
        id: fixtureId('ans'),
        status: isSkip ? 'SKIPPED' : 'ANSWERED',
        transcript: isSkip ? '' : req.transcript!.trim(),
        durationSeconds: isSkip ? null : Math.round(req.durationSeconds ?? 0),
        inputMode: isSkip ? null : (req.inputMode ?? 'TEXT'),
        submittedAt: now(),
      };
      session.submittedKeys.push(req.idempotencyKey!);
      refreshLive(state, interview, session);
      save(state);
      return currentQuestion(state, interview);
    },
  ],
  [
    'POST',
    /^\/candidate\/sessions\/([^/]+)\/complete$/,
    ({ state, params }) => {
      const { session, interview } = requireCandidate(state, params[0]);
      if (!DONE_STATUSES.includes(interview.status)) {
        const answers = (state.answers[interview.id] ??= {});
        for (const q of interview.questions) {
          if (!answers[q.id]) {
            answers[q.id] = { id: fixtureId('ans'), status: 'UNANSWERED', transcript: '', durationSeconds: null, inputMode: null, submittedAt: null };
          }
        }
        interview.status = 'COMPLETED';
        interview.endedAt = now();
        session.completedAt = interview.endedAt;
        // No real Egress job exists in fixture mode, so the recording never becomes READY.
        if (interview.recordingStatus === 'RECORDING') {
          interview.recordingStatus = 'FINALIZING';
          state.recordings[interview.id] = (state.recordings[interview.id] ?? []).map((r) => ({ ...r, status: 'FINALIZING' as const }));
        }
        refreshLive(state, interview, session);
        save(state);
      }
      return { status: interview.status, submittedAt: interview.endedAt ?? now(), progress: progressOf(state, interview).progress };
    },
  ],

  // ----------------------------------------------------------------------------- interviews
  [
    'GET',
    /^\/interviews$/,
    ({ state, query }): ListInterviewsResponse => {
      requireRecruiter(state);
      state.interviews.forEach((i) => applyEvaluationProgress(state, i));
      const all = [...state.interviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(summary);
      const search = String(query?.search ?? '').trim().toLowerCase();
      const status = query?.status as InterviewStatus | undefined;
      const items = all.filter(
        (i) =>
          (!status || i.status === status) &&
          (!search || `${i.jobTitle} ${i.candidateName} ${i.candidateEmail}`.toLowerCase().includes(search)),
      );
      return { items, stats: statsOf(all) };
    },
  ],
  [
    'POST',
    /^\/interviews$/,
    ({ state, body }) => {
      requireRecruiter(state);
      const req = body as CreateInterviewRequest;
      const errors: Record<string, string> = {};
      if (!req.jobTitle?.trim()) errors.jobTitle = 'Job title is required.';
      if (!req.jobDescription?.trim()) errors.jobDescription = 'Job description is required.';
      if (!req.candidateName?.trim()) errors.candidateName = 'Candidate name is required.';
      if (!/^\S+@\S+\.\S+$/.test(req.candidateEmail ?? '')) errors.candidateEmail = 'Enter a valid email address.';
      if (Object.keys(errors).length) fail(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', { fields: errors });
      const id = fixtureId('int');
      const interview: InterviewDetail = {
        id,
        jobTitle: req.jobTitle.trim(),
        candidateName: req.candidateName.trim(),
        candidateEmail: req.candidateEmail.trim(),
        status: 'DRAFT',
        questionCount: req.config.questionCount ?? 10,
        overallScore: null,
        maxScore: 10,
        recordingStatus: 'NOT_ENABLED',
        createdAt: now(),
        startedAt: null,
        endedAt: null,
        jobDescription: req.jobDescription.trim(),
        requiredSkills: req.requiredSkills,
        config: {
          questionCount: req.config.questionCount ?? 10,
          durationMinutes: req.config.durationMinutes ?? 30,
          difficulty: req.config.difficulty ?? 'MEDIUM',
          experienceLevel: req.config.experienceLevel ?? 'MID',
          categories: req.config.categories ?? ['TECHNICAL', 'BEHAVIORAL'],
          allowSkip: req.config.allowSkip ?? true,
          allowFollowUps: req.config.allowFollowUps ?? false,
          maxFollowUps: req.config.maxFollowUps ?? 0,
          secondaryCamera: req.config.secondaryCamera ?? 'OPTIONAL',
          recordingEnabled: req.config.recordingEnabled ?? false,
        },
        resume: null,
        questions: [],
        invitation: null,
        live: null,
      };
      state.interviews.push(interview);
      state.answers[id] = {};
      state.evaluations[id] = {};
      state.overall[id] = null;
      state.evaluation[id] = { status: 'NOT_STARTED', failureCode: null, requestedAt: null };
      state.events[id] = [];
      state.recordings[id] = [];
      save(state);
      return interview;
    },
  ],
  [
    'GET',
    /^\/interviews\/([^/]+)$/,
    ({ state, params }) => {
      requireRecruiter(state);
      const interview = findInterview(state, params[0]);
      applyEvaluationProgress(state, interview);
      if (interview.live) interview.live.updatedAt = now();
      return interview;
    },
  ],
  [
    'PATCH',
    /^\/interviews\/([^/]+)$/,
    ({ state, params, body }) => {
      requireRecruiter(state);
      const interview = findInterview(state, params[0]);
      if (interview.status !== 'DRAFT') fail(409, 'CONFLICT', 'Only draft interviews can be edited. Setup is locked once the invitation is issued.');
      const { config, ...fields } = (body ?? {}) as UpdateInterviewRequest;
      Object.assign(interview, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
      if (config) interview.config = { ...interview.config, ...config };
      save(state);
      return interview;
    },
  ],
  [
    'DELETE',
    /^\/interviews\/([^/]+)$/,
    ({ state, params }) => {
      requireRecruiter(state);
      const interview = findInterview(state, params[0]);
      if (interview.status !== 'DRAFT') fail(409, 'CONFLICT', 'Only drafts can be deleted. Cancel this interview instead so its history is kept.');
      state.interviews = state.interviews.filter((i) => i.id !== interview.id);
      save(state);
      return undefined;
    },
  ],
  [
    'POST',
    /^\/interviews\/([^/]+)\/cancel$/,
    ({ state, params }) => {
      requireRecruiter(state);
      const interview = findInterview(state, params[0]);
      if (!['DRAFT', 'READY', 'ONBOARDING', 'IN_PROGRESS', 'PROCESSING_ANSWER', 'CANCELLED'].includes(interview.status)) {
        fail(409, 'CONFLICT', 'A finished interview cannot be cancelled. Its answers and report are kept for review.');
      }
      if (interview.status !== 'CANCELLED') {
        if (interview.startedAt) interview.endedAt = now();
        interview.status = 'CANCELLED';
        interview.live = null;
        for (const [sessionId, session] of Object.entries(state.sessions)) {
          if (session.interviewId === interview.id) delete state.sessions[sessionId];
        }
        save(state);
      }
      return interview;
    },
  ],
  [
    'POST',
    /^\/interviews\/([^/]+)\/resume$/,
    ({ state, params, body }) => {
      requireRecruiter(state);
      const interview = findInterview(state, params[0]);
      const file = body instanceof FormData ? body.get('resume') : null;
      if (!(file instanceof File)) return fail(400, 'VALIDATION_ERROR', 'Choose a resume file to upload.');
      const okType =
        /\.(pdf|docx)$/i.test(file.name) ||
        ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type);
      if (!okType) fail(415, 'RESUME_UNSUPPORTED', 'Upload a PDF or DOCX file.');
      if (file.size > 5 * 1024 * 1024) fail(413, 'VALIDATION_ERROR', 'Resume must be 5 MB or smaller.');
      interview.resume = {
        id: fixtureId('res'),
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        // FIXTURE: no document service runs in fixture mode, so extraction is reported as completed.
        extractionStatus: 'COMPLETED',
        failureCode: null,
      };
      save(state);
      return { resume: interview.resume };
    },
  ],
  [
    'POST',
    /^\/interviews\/([^/]+)\/questions\/generate$/,
    ({ state, params, body }) => {
      requireRecruiter(state);
      const interview = findInterview(state, params[0]);
      if (interview.status !== 'DRAFT') fail(409, 'CONFLICT', 'Questions can only be generated while the interview is a draft.');
      const count = (body as { count?: number } | undefined)?.count ?? interview.config.questionCount ?? 10;
      if (count < 1 || count > 30) fail(400, 'VALIDATION_ERROR', 'Question count must be between 1 and 30.');
      const questions = generateFixtureQuestions(interview.id, count, interview.config.categories, interview.requiredSkills);
      interview.questions = questions;
      interview.questionCount = questions.length;
      save(state);
      return { questions };
    },
  ],
  [
    'PATCH',
    /^\/interviews\/([^/]+)\/questions$/,
    ({ state, params, body }) => {
      requireRecruiter(state);
      const interview = findInterview(state, params[0]);
      if (interview.status !== 'DRAFT') fail(409, 'CONFLICT', 'Questions are locked once the interview is ready.');
      const drafts = ((body as { questions?: QuestionDraft[] })?.questions ?? []).map((q) => ({ ...q, text: q.text.trim() }));
      if (drafts.length === 0) fail(400, 'VALIDATION_ERROR', 'Add at least one question.');
      if (drafts.some((q) => !q.text)) fail(400, 'VALIDATION_ERROR', 'Questions cannot be empty.');
      const texts = drafts.map((q) => q.text.toLowerCase());
      if (new Set(texts).size !== texts.length) fail(400, 'VALIDATION_ERROR', 'Remove duplicate questions before saving.');
      interview.questions = drafts.map((q, i) => ({ ...q, id: q.id ?? fixtureId('q'), sequence: i + 1 }));
      interview.questionCount = interview.questions.length;
      save(state);
      return { questions: interview.questions };
    },
  ],
  [
    'POST',
    /^\/interviews\/([^/]+)\/ready$/,
    ({ state, params }) => {
      requireRecruiter(state);
      const interview = findInterview(state, params[0]);
      if (interview.status !== 'DRAFT' && interview.status !== 'READY') fail(409, 'CONFLICT', 'This interview has already started.');
      if (interview.questions.length === 0) fail(400, 'VALIDATION_ERROR', 'Save at least one approved question first.');
      if (!interview.invitation) {
        const block = () => Math.random().toString(36).slice(2, 6).toUpperCase();
        const code = `HB-${block()}-${block()}`;
        interview.invitation = {
          code,
          accessCode: String(Math.floor(100000 + Math.random() * 900000)),
          url: `/candidate/login?code=${code}`,
          expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        };
      }
      interview.status = 'READY';
      save(state);
      return { interview, invitation: interview.invitation };
    },
  ],
  [
    'POST',
    /^\/interviews\/([^/]+)\/evaluate$/,
    ({ state, params }) => {
      requireRecruiter(state);
      const interview = findInterview(state, params[0]);
      if (!['COMPLETED', 'EVALUATION_FAILED', 'EVALUATING'].includes(interview.status)) {
        fail(409, 'CONFLICT', 'Evaluation can only run after the interview is completed.');
      }
      if (interview.id === 'int_1005') {
        // Keeps one fixture permanently failing so the provider-failure state stays demoable.
        fail(503, 'PROVIDER_UNAVAILABLE', 'The evaluation provider is not configured in fixture mode. Answers are preserved.');
      }
      if (state.evaluation[interview.id]?.status !== 'EVALUATING') {
        state.evaluation[interview.id] = { status: 'EVALUATING', failureCode: null, requestedAt: Date.now() };
        interview.status = 'EVALUATING';
        save(state);
      }
      return { evaluationStatus: 'EVALUATING' };
    },
  ],
  [
    'GET',
    /^\/interviews\/([^/]+)\/report$/,
    ({ state, params }) => {
      requireRecruiter(state);
      const interview = findInterview(state, params[0]);
      applyEvaluationProgress(state, interview);
      save(state);
      const answers = state.answers[interview.id] ?? {};
      const evaluations = state.evaluations[interview.id] ?? {};
      const ev = state.evaluation[interview.id];
      return {
        interview: { ...summary(interview), requiredSkills: interview.requiredSkills },
        evaluationStatus: ev?.status ?? 'NOT_STARTED',
        evaluationFailureCode: ev?.failureCode ?? null,
        overall: state.overall[interview.id] ?? null,
        items: interview.questions.map((q) => ({ question: q, answer: answers[q.id] ?? null, evaluation: evaluations[q.id] ?? null })),
        proctoringEvents: state.events[interview.id] ?? [],
        generatedAt: now(),
      };
    },
  ],

  // ----------------------------------------------------------------------------- recordings
  [
    'GET',
    /^\/interviews\/([^/]+)\/recordings$/,
    ({ state, params }) => {
      requireRecruiter(state);
      findInterview(state, params[0]);
      return { items: state.recordings[params[0]] ?? [] };
    },
  ],
  [
    'POST',
    /^\/recordings\/([^/]+)\/playback-url$/,
    ({ state, params }) => {
      requireRecruiter(state);
      const recording = Object.values(state.recordings).flat().find((r) => r.id === params[0]);
      if (!recording) return fail(404, 'NOT_FOUND', 'Recording not found.');
      if (recording.status === 'DELETED') fail(410, 'RECORDING_DELETED', 'This recording has been deleted.');
      if (recording.status !== 'READY') fail(409, 'RECORDING_NOT_READY', 'The recording is not ready yet.');
      // Never fabricate a playable file (PRD §4.1): fixture mode has no R2 object to sign.
      return fail(
        503,
        'RECORDING_UNAVAILABLE',
        'Fixture mode has no real recording file. Connect the backend with LiveKit Egress and R2 to play recordings.',
      );
    },
  ],

  // ----------------------------------------------------------------------------- reviews
  [
    'PATCH',
    /^\/evaluations\/([^/]+)\/review$/,
    ({ state, params, body }) => {
      requireRecruiter(state);
      const req = body as ReviewEvaluationRequest;
      for (const interview of state.interviews) {
        const evaluations = state.evaluations[interview.id] ?? {};
        const evaluation = Object.values(evaluations).find((e) => e.id === params[0]);
        if (!evaluation) continue;
        if (req.reviewStatus === 'OVERRIDDEN') {
          if (req.score === undefined || req.score < 0 || req.score > evaluation.maxScore) {
            fail(400, 'VALIDATION_ERROR', `Score must be between 0 and ${evaluation.maxScore}.`);
          }
          if (!req.reason?.trim()) fail(400, 'VALIDATION_ERROR', 'Add a reason for the override.');
          evaluation.override = { score: req.score!, reason: req.reason!.trim(), reviewerName: FIXTURE_RECRUITER.name, reviewedAt: now() };
        } else {
          evaluation.override = null;
        }
        evaluation.reviewStatus = req.reviewStatus;
        state.overall[interview.id] = overallFrom(Object.values(evaluations));
        interview.overallScore = state.overall[interview.id]?.score ?? null;
        const allReviewed = Object.values(evaluations).every((e) => e.reviewStatus !== 'AI_ONLY');
        if (allReviewed && interview.status === 'EVALUATED') interview.status = 'REVIEWED';
        save(state);
        return evaluation;
      }
      return fail(404, 'NOT_FOUND', 'Evaluation not found.');
    },
  ],
  [
    'PATCH',
    /^\/proctoring-events\/([^/]+)\/review$/,
    ({ state, params, body }) => {
      requireRecruiter(state);
      const req = body as ReviewProctoringEventRequest;
      const event = Object.values(state.events).flat().find((e) => e.id === params[0]) as ProctoringEvent | undefined;
      if (!event) return fail(404, 'NOT_FOUND', 'Event not found.');
      event.reviewStatus = req.reviewStatus;
      event.reviewerNote = req.reviewerNote?.trim() || null;
      save(state);
      return event;
    },
  ],
];

export const mockTransport: Transport = {
  async request<T>({ method, path, body, query, signal }: RequestOptions): Promise<T> {
    await delay(200 + Math.random() * 250);
    if (signal?.aborted) throw new ApiError('ABORTED', 'Request was cancelled.', 0);
    const state = load();
    for (const [m, pattern, handler] of routes) {
      if (m !== method) continue;
      const match = pattern.exec(path);
      if (!match) continue;
      const params = match.slice(1).map(decodeURIComponent);
      // Hand out copies so UI code can never mutate fixture state by accident.
      const result = handler({ state, params, body, query });
      return (result === undefined ? undefined : structuredClone(result)) as T;
    }
    return fail(404, 'NOT_FOUND', `Fixture transport has no route for ${method} ${path}.`);
  },
};

/** FIXTURE-only controls for things a real device or provider would do (e.g. a phone pairing). */
export const fixtureControls = {
  setPhonePaired(sessionId: string, paired: boolean) {
    const state = load();
    const session = state.sessions[sessionId];
    if (!session) return;
    session.pairingStatus = paired ? 'PAIRED' : 'DISCONNECTED';
    const interview = state.interviews.find((i) => i.id === session.interviewId);
    if (interview) {
      if (interview.live) interview.live.secondaryCamera = paired ? 'CONNECTED' : 'DISCONNECTED';
      refreshLive(state, interview, session);
    }
    save(state);
  },
  reset() {
    memoryState = null;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  },
};
