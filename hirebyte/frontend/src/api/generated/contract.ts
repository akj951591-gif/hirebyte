/**
 * HIREBYTE API CONTRACT TYPES (provisional, PRD v2.1 §11).
 *
 * Canonical file: backend/contracts/api-types.ts. A byte-identical copy lives in
 * frontend/src/api/generated/contract.ts; backend test `contract.sync.test.ts` fails if they differ.
 * Change the canonical file, then copy it to the frontend (`npm run sync:contract` in frontend).
 * backend/contracts/openapi.yaml should be generated from / kept equivalent to these types.
 */

// ---------------------------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------------------------

export type UserRole = 'RECRUITER' | 'ADMIN';

export type InterviewStatus =
  | 'DRAFT'
  | 'READY'
  | 'ONBOARDING'
  | 'IN_PROGRESS'
  | 'PROCESSING_ANSWER'
  | 'COMPLETED'
  | 'EVALUATING'
  | 'EVALUATED'
  | 'EVALUATION_FAILED'
  | 'REVIEWED'
  | 'CANCELLED';

export type RecordingStatus =
  | 'NOT_ENABLED'
  | 'PENDING'
  | 'RECORDING'
  | 'FINALIZING'
  | 'READY'
  | 'FAILED'
  | 'DELETED';

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type ExperienceLevel = 'INTERN' | 'JUNIOR' | 'MID' | 'SENIOR' | 'LEAD';
export type QuestionCategory = 'TECHNICAL' | 'BEHAVIORAL' | 'SITUATIONAL' | 'RESUME' | 'SYSTEM_DESIGN';
export type QuestionSource = 'AI_GENERATED' | 'RECRUITER' | 'FOLLOW_UP';
export type AnswerStatus = 'ANSWERED' | 'SKIPPED' | 'UNANSWERED';
export type AnswerInputMode = 'VOICE' | 'TEXT';
export type SecondaryCameraPolicy = 'OFF' | 'OPTIONAL' | 'REQUIRED';
export type ExtractionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type EvaluationStatus = 'NOT_STARTED' | 'EVALUATING' | 'EVALUATED' | 'FAILED';
export type EvaluationReviewStatus = 'AI_ONLY' | 'CONFIRMED' | 'OVERRIDDEN';
export type CameraSource = 'PRIMARY' | 'SECONDARY';
export type MediaConnectionStatus = 'NOT_CONNECTED' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';
export type PairingStatus = 'NOT_PAIRED' | 'PAIRED' | 'DISCONNECTED' | 'EXPIRED';

export type ProctoringEventType =
  | 'FACE_ABSENT'
  | 'MULTIPLE_FACES'
  | 'LOOKING_AWAY'
  | 'TAB_HIDDEN'
  | 'SECONDARY_CONNECTED'
  | 'SECONDARY_DISCONNECTED'
  | 'AUDIO_ISSUE';

/** Observation review state. Events are for human review, never a cheating verdict (PRD §13). */
export type ProctoringReviewStatus = 'UNREVIEWED' | 'NO_CONCERN' | 'NEEDS_FOLLOW_UP';

/** Error codes the UI branches on. Unknown codes fall back to the generic error message. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'INVITATION_INVALID'
  | 'INVITATION_EXPIRED'
  | 'INTERVIEW_COMPLETED'
  | 'SESSION_LOCKED'
  | 'SESSION_EXPIRED'
  | 'CONSENT_REQUIRED'
  | 'SECONDARY_CAMERA_REQUIRED'
  | 'SKIP_NOT_ALLOWED'
  | 'DUPLICATE_SUBMISSION'
  | 'RESUME_UNSUPPORTED'
  | 'RESUME_UNREADABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'MEDIA_NOT_CONFIGURED'
  | 'RECORDING_NOT_READY'
  | 'RECORDING_UNAVAILABLE'
  | 'RECORDING_DELETED'
  | 'RECORDING_DELETE_FAILED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/** PRD §11.1 standard error body. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode | string;
    message: string;
    requestId?: string;
    details?: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------------------------
// Auth — POST /auth/recruiter/login, POST /auth/recruiter/logout, GET /auth/me
// ---------------------------------------------------------------------------------------------

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface RecruiterLoginRequest {
  email: string;
  password: string;
}

/** Session is carried by an HttpOnly cookie; the body only echoes the safe identity. */
export interface RecruiterLoginResponse {
  user: SafeUser;
}

export interface MeResponse {
  user: SafeUser;
}

// ---------------------------------------------------------------------------------------------
// Interviews (recruiter)
// ---------------------------------------------------------------------------------------------

export interface InterviewConfig {
  /** Backend defaults to 10 when omitted (PRD §19). */
  questionCount: number;
  durationMinutes: number;
  difficulty: Difficulty;
  experienceLevel: ExperienceLevel;
  categories: QuestionCategory[];
  allowSkip: boolean;
  allowFollowUps: boolean;
  maxFollowUps: number;
  secondaryCamera: SecondaryCameraPolicy;
  /** Requested by the recruiter; the server still applies RECORDING_ENABLED policy. */
  recordingEnabled: boolean;
}

export interface InterviewProgress {
  answered: number;
  skipped: number;
  total: number;
  /** 1-based sequence of the question currently shown, null before start / after the last one. */
  currentSequence: number | null;
}

export interface InterviewSummary {
  id: string;
  jobTitle: string;
  candidateName: string;
  candidateEmail: string;
  status: InterviewStatus;
  questionCount: number;
  overallScore: number | null;
  maxScore: number;
  recordingStatus: RecordingStatus;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ResumeInfo {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  extractionStatus: ExtractionStatus;
  failureCode: string | null;
}

export interface Question {
  id: string;
  sequence: number;
  text: string;
  category: QuestionCategory;
  difficulty: Difficulty;
  targetSkills: string[];
  evaluationCriteria: string[];
  expectedAnswerPoints: string[];
  source: QuestionSource;
}

export interface Invitation {
  code: string;
  accessCode: string;
  url: string;
  expiresAt: string;
}

/** Live snapshot for the monitor page (to be replaced/augmented by Socket.IO events, §11.2). */
export interface InterviewLiveState {
  progress: InterviewProgress;
  primaryCamera: MediaConnectionStatus;
  secondaryCamera: MediaConnectionStatus;
  recentEvents: ProctoringEvent[];
  updatedAt: string;
}

export interface InterviewDetail extends InterviewSummary {
  jobDescription: string;
  requiredSkills: string[];
  config: InterviewConfig;
  resume: ResumeInfo | null;
  questions: Question[];
  invitation: Invitation | null;
  live: InterviewLiveState | null;
}

export interface InterviewStats {
  total: number;
  inProgress: number;
  completed: number;
  pendingReview: number;
}

export interface ListInterviewsQuery {
  search?: string;
  status?: InterviewStatus;
}

export interface ListInterviewsResponse {
  items: InterviewSummary[];
  stats: InterviewStats;
}

export interface CreateInterviewRequest {
  jobTitle: string;
  jobDescription: string;
  requiredSkills: string[];
  candidateName: string;
  candidateEmail: string;
  config: Partial<InterviewConfig>;
}

/**
 * PATCH /interviews/:id (DRAFT only) → InterviewDetail. Omitted fields are unchanged; `config` is
 * merged into the saved config. Related: DELETE /interviews/:id (DRAFT only) → 204, and
 * POST /interviews/:id/cancel (any unfinished status) → InterviewDetail with status CANCELLED.
 */
export interface UpdateInterviewRequest {
  jobTitle?: string;
  jobDescription?: string;
  requiredSkills?: string[];
  candidateName?: string;
  candidateEmail?: string;
  config?: Partial<InterviewConfig>;
}

export interface UploadResumeResponse {
  resume: ResumeInfo;
}

export interface GenerateQuestionsRequest {
  /** Omit to let the backend apply its default (10). */
  count?: number;
}

export interface GenerateQuestionsResponse {
  questions: Question[];
}

/** Array order is the approved sequence. Items without an id are new recruiter-authored questions. */
export interface QuestionDraft {
  id?: string;
  text: string;
  category: QuestionCategory;
  difficulty: Difficulty;
  targetSkills: string[];
  evaluationCriteria: string[];
  expectedAnswerPoints: string[];
  source: QuestionSource;
}

export interface UpdateQuestionsRequest {
  questions: QuestionDraft[];
}

export interface UpdateQuestionsResponse {
  questions: Question[];
}

export interface MarkReadyResponse {
  interview: InterviewDetail;
  invitation: Invitation;
}

// ---------------------------------------------------------------------------------------------
// Candidate session — POST /candidate/access, /candidate/sessions/:sessionId/*
// Candidate DTOs deliberately omit rubric, scores, notes and recording admin data (PRD §2.1).
// ---------------------------------------------------------------------------------------------

export interface CandidateAccessRequest {
  invitationCode: string;
  accessCode: string;
}

/** The scoped session token is set as an HttpOnly cookie; only the opaque id is returned. */
export interface CandidateAccessResponse {
  sessionId: string;
  expiresAt: string;
}

export interface RecordingNotice {
  enabled: boolean;
  /** When true the interview cannot proceed without recording consent, and the UI says so. */
  required: boolean;
  noticeVersion: string;
  feeds: string[];
  purpose: string;
  access: string;
  retention: string;
}

export interface ProctoringNotice {
  enabled: boolean;
  noticeVersion: string;
  description: string;
}

export interface ConsentState {
  recordingConsent: boolean;
  proctoringConsent: boolean;
  consentedAt: string;
}

export interface PhonePairing {
  url: string;
  expiresAt: string;
  status: PairingStatus;
}

export interface CandidateSessionView {
  sessionId: string;
  interviewId: string;
  status: InterviewStatus;
  candidateName: string;
  jobTitle: string;
  companyName: string;
  estimatedDurationMinutes: number;
  questionCount: number;
  allowSkip: boolean;
  instructions: string[];
  recording: RecordingNotice;
  proctoring: ProctoringNotice;
  secondaryCamera: SecondaryCameraPolicy;
  consent: ConsentState | null;
  pairing: PhonePairing | null;
  expiresAt: string;
}

export interface ConsentRequest {
  recordingNoticeVersion: string;
  proctoringNoticeVersion: string;
  recordingConsent: boolean;
  proctoringConsent: boolean;
}

export interface ConsentResponse {
  consent: ConsentState;
}

export interface CandidateQuestion {
  id: string;
  sequence: number;
  text: string;
  category: QuestionCategory;
}

export interface CurrentQuestionResponse {
  status: InterviewStatus;
  /** null once every question has been answered or skipped. */
  question: CandidateQuestion | null;
  progress: InterviewProgress;
  startedAt: string | null;
  durationMinutes: number;
  allowSkip: boolean;
}

export interface SubmitAnswerRequest {
  questionId: string;
  transcript: string;
  durationSeconds: number;
  inputMode: AnswerInputMode;
  /** Same key on retry → server returns the saved result instead of a duplicate answer. */
  idempotencyKey: string;
}

export interface SkipQuestionRequest {
  questionId: string;
  idempotencyKey: string;
}

export interface CompleteSessionResponse {
  status: InterviewStatus;
  submittedAt: string;
  progress: InterviewProgress;
}

// ---------------------------------------------------------------------------------------------
// Recordings — GET /interviews/:id/recordings, POST /recordings/:id/playback-url
// ---------------------------------------------------------------------------------------------

export interface Recording {
  id: string;
  interviewId: string;
  status: RecordingStatus;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  startedAt: string | null;
  completedAt: string | null;
  failureCode: string | null;
}

export interface ListRecordingsResponse {
  items: Recording[];
}

/** Short-lived signed URL. Never log or persist it. */
export interface PlaybackUrlResponse {
  url: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------------------------
// Evaluation, proctoring and report
// ---------------------------------------------------------------------------------------------

export interface CriterionScore {
  criterion: string;
  score: number;
  maxScore: number;
}

export interface EvaluationOverride {
  score: number;
  reason: string;
  reviewerName: string;
  reviewedAt: string;
}

export interface Evaluation {
  id: string;
  questionId: string;
  /** null when the question was unanswered — distinct from a zero score (PRD §8.3). */
  score: number | null;
  maxScore: number;
  criteria: CriterionScore[];
  evidence: string[];
  explanation: string;
  strengths: string[];
  gaps: string[];
  reviewStatus: EvaluationReviewStatus;
  /** Original AI assessment is preserved; override sits alongside it. */
  override: EvaluationOverride | null;
}

export interface ReviewEvaluationRequest {
  reviewStatus: Exclude<EvaluationReviewStatus, 'AI_ONLY'>;
  score?: number;
  reason?: string;
}

export interface ProctoringEvent {
  id: string;
  type: ProctoringEventType;
  occurredAt: string;
  durationSeconds: number | null;
  sourceCamera: CameraSource;
  description: string;
  reviewStatus: ProctoringReviewStatus;
  reviewerNote: string | null;
}

export interface ReviewProctoringEventRequest {
  reviewStatus: ProctoringReviewStatus;
  reviewerNote?: string;
}

export interface ReportAnswer {
  id: string;
  status: AnswerStatus;
  transcript: string;
  durationSeconds: number | null;
  inputMode: AnswerInputMode | null;
  submittedAt: string | null;
}

export interface ReportItem {
  question: Question;
  answer: ReportAnswer | null;
  evaluation: Evaluation | null;
}

export interface OverallAssessment {
  score: number | null;
  maxScore: number;
  summary: string;
  strengths: string[];
  gaps: string[];
}

export interface InterviewReport {
  interview: InterviewSummary & { requiredSkills: string[] };
  evaluationStatus: EvaluationStatus;
  evaluationFailureCode: string | null;
  overall: OverallAssessment | null;
  items: ReportItem[];
  proctoringEvents: ProctoringEvent[];
  generatedAt: string;
}

export interface EvaluateResponse {
  evaluationStatus: EvaluationStatus;
}

/**
 * POST /interviews/:id/media-token. The credential decides the role: recruiter cookie → 'viewer'
 * (hidden, subscribe-only), candidate cookie → 'primary' (laptop), one-time pairing token → 'secondary' (phone).
 */
export interface MediaTokenRequest {
  device?: 'primary' | 'secondary' | 'viewer';
  /** 'secondary' first time: the token from the QR pairing link. Single use. */
  pairingToken?: string;
  /** 'secondary' after a reload: the deviceToken returned when the phone paired. */
  deviceToken?: string;
}

/** Short-lived, room-scoped LiveKit credentials. */
export interface MediaTokenResponse {
  url: string;
  token: string;
  room: string;
  identity: string;
  expiresAt: string;
  /**
   * Only when a phone pairs: keep it (e.g. sessionStorage) to get new tokens after a reload.
   * The next pairing replaces it, so a replaced phone can no longer rejoin.
   */
  deviceToken?: string;
}

/** POST /interviews/:id/events (candidate session, while the interview runs). Observation only. */
export interface CreateProctoringEventRequest {
  type: 'FACE_ABSENT' | 'MULTIPLE_FACES' | 'LOOKING_AWAY' | 'TAB_HIDDEN' | 'AUDIO_ISSUE';
  occurredAt?: string;
  durationSeconds?: number;
  sourceCamera?: CameraSource;
  description?: string;
}

export type ProviderConfigState = 'configured' | 'not_configured';

/** GET /health (public): configuration state only, never secrets. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'ok' | 'error';
  nodeEnv: string;
  media: ProviderConfigState;
  storage: ProviderConfigState;
  recording: 'enabled' | 'disabled';
  ai: ProviderConfigState;
  documents: ProviderConfigState;
}

// ---------------------------------------------------------------------------------------------
// Realtime events (Socket.IO, PRD §11.2). Documented in backend/contracts/events.md.
// The socket lives at /api/socket.io and authenticates with the same session cookies as the API.
// ---------------------------------------------------------------------------------------------

/** Which session the socket should use; sent as `auth.role` in the Socket.IO handshake. */
export type RealtimeRole = 'recruiter' | 'candidate';

export interface RealtimeEventMap {
  'interview.status_changed': { interviewId: string; status: InterviewStatus; timestamp: string };
  'interview.question_changed': { interviewId: string; questionId: string; sequence: number; timestamp: string };
  'answer.saved': { interviewId: string; questionId: string; status: AnswerStatus; timestamp: string };
  'proctoring.event_created': {
    interviewId: string;
    eventId: string;
    type: ProctoringEventType;
    sourceCamera: CameraSource;
    timestamp: string;
  };
  'media.secondary_connected': { interviewId: string; status: PairingStatus; timestamp: string };
  'media.secondary_disconnected': { interviewId: string; status: PairingStatus; timestamp: string };
  /** `failureCode` is a safe code such as EGRESS_START_FAILED; never a URL or provider payload. */
  'recording.status_changed': {
    interviewId: string;
    recordingId: string;
    status: RecordingStatus;
    failureCode: string | null;
    timestamp: string;
  };
  'evaluation.status_changed': { interviewId: string; status: EvaluationStatus; timestamp: string };
}

export type RealtimeEventName = keyof RealtimeEventMap;

/** The only events a candidate socket receives, and only for its own interview. */
export type CandidateRealtimeEventName = 'interview.status_changed' | 'media.secondary_connected' | 'media.secondary_disconnected';
