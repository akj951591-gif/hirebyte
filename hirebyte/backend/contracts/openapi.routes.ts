/**
 * Every REST endpoint of the Node API, described for backend/contracts/openapi.yaml.
 * Request/response names refer to types exported from api-types.ts.
 *
 * Regenerate after changing routes or types:  npm run contract:openapi  (in backend/api)
 * A backend test fails if a route is missing here or openapi.yaml is out of date.
 */
import type { ApiErrorCode } from './api-types.js';

export type RouteAuth = 'public' | 'recruiter' | 'candidate' | 'mediaToken' | 'webhook';

export interface RouteDoc {
  method: 'get' | 'post' | 'patch' | 'delete';
  /** Express-style path below /api, e.g. /interviews/:id */
  path: string;
  tag: 'Auth' | 'Candidate' | 'Interviews' | 'Questions' | 'Evaluation' | 'Media' | 'Recordings' | 'Proctoring' | 'System';
  auth: RouteAuth;
  summary: string;
  request?: string;
  /** multipart/form-data upload field instead of a JSON body. */
  upload?: { field: string; description: string };
  query?: string;
  /** Response type; null means an empty response. */
  response: string | null;
  status?: 200 | 201 | 202 | 204;
  /** Binary responses (e.g. PDF) instead of JSON. */
  contentType?: string;
  errors: ApiErrorCode[];
}

const AUTH_ERRORS: ApiErrorCode[] = ['UNAUTHENTICATED'];
const OWNED: ApiErrorCode[] = ['UNAUTHENTICATED', 'NOT_FOUND'];
const CANDIDATE: ApiErrorCode[] = ['SESSION_EXPIRED', 'FORBIDDEN'];

export const routes: RouteDoc[] = [
  { method: 'get', path: '/health', tag: 'System', auth: 'public', summary: 'Database and provider configuration state (never secrets).', response: 'HealthResponse', errors: [] },

  { method: 'post', path: '/auth/recruiter/login', tag: 'Auth', auth: 'public', summary: 'Recruiter email + password sign-in; sets the hb_session cookie. Rate-limited.', request: 'RecruiterLoginRequest', response: 'RecruiterLoginResponse', errors: ['VALIDATION_ERROR', 'INVALID_CREDENTIALS', 'ACCOUNT_LOCKED', 'RATE_LIMITED'] },
  { method: 'post', path: '/auth/recruiter/logout', tag: 'Auth', auth: 'public', summary: 'Revokes the recruiter session (if any) and clears the cookie.', response: null, status: 204, errors: [] },
  { method: 'get', path: '/auth/me', tag: 'Auth', auth: 'recruiter', summary: 'Safe identity and role of the signed-in recruiter.', response: 'MeResponse', errors: AUTH_ERRORS },

  { method: 'post', path: '/candidate/access', tag: 'Candidate', auth: 'public', summary: 'Validates invitation + access code; sets the hb_candidate cookie. Rate-limited, locks after 5 failures.', request: 'CandidateAccessRequest', response: 'CandidateAccessResponse', errors: ['VALIDATION_ERROR', 'INVITATION_INVALID', 'INVITATION_EXPIRED', 'INTERVIEW_COMPLETED', 'SESSION_LOCKED', 'RATE_LIMITED'] },
  { method: 'post', path: '/candidate/logout', tag: 'Candidate', auth: 'public', summary: 'Ends the candidate session (if any) and clears the cookie.', response: null, status: 204, errors: [] },
  { method: 'get', path: '/candidate/sessions/:sessionId', tag: 'Candidate', auth: 'candidate', summary: 'Candidate-safe interview view: instructions, notices, consent, phone pairing.', response: 'CandidateSessionView', errors: CANDIDATE },
  { method: 'post', path: '/candidate/sessions/:sessionId/consent', tag: 'Candidate', auth: 'candidate', summary: 'Records recording and observation consent for the notice versions shown.', request: 'ConsentRequest', response: 'ConsentResponse', errors: [...CANDIDATE, 'VALIDATION_ERROR', 'CONSENT_REQUIRED', 'CONFLICT'] },
  { method: 'post', path: '/candidate/sessions/:sessionId/start', tag: 'Candidate', auth: 'candidate', summary: 'Starts the interview (and recording, if enabled and consented); idempotent.', response: 'CurrentQuestionResponse', errors: [...CANDIDATE, 'CONSENT_REQUIRED', 'SECONDARY_CAMERA_REQUIRED', 'INTERVIEW_COMPLETED', 'CONFLICT'] },
  { method: 'get', path: '/candidate/sessions/:sessionId/current-question', tag: 'Candidate', auth: 'candidate', summary: 'Current question and progress, restored from the database after a refresh.', response: 'CurrentQuestionResponse', errors: CANDIDATE },
  { method: 'post', path: '/candidate/sessions/:sessionId/answers', tag: 'Candidate', auth: 'candidate', summary: 'Saves the answer to the current question; a retry with the same idempotency key is a no-op.', request: 'SubmitAnswerRequest', response: 'CurrentQuestionResponse', errors: [...CANDIDATE, 'VALIDATION_ERROR', 'DUPLICATE_SUBMISSION', 'CONFLICT'] },
  { method: 'post', path: '/candidate/sessions/:sessionId/skip', tag: 'Candidate', auth: 'candidate', summary: 'Skips the current question when the interview allows it.', request: 'SkipQuestionRequest', response: 'CurrentQuestionResponse', errors: [...CANDIDATE, 'SKIP_NOT_ALLOWED', 'DUPLICATE_SUBMISSION', 'CONFLICT'] },
  { method: 'post', path: '/candidate/sessions/:sessionId/complete', tag: 'Candidate', auth: 'candidate', summary: 'Submits the interview; open questions become UNANSWERED. Idempotent.', response: 'CompleteSessionResponse', errors: [...CANDIDATE, 'CONFLICT'] },

  { method: 'post', path: '/interviews', tag: 'Interviews', auth: 'recruiter', summary: 'Creates a DRAFT interview (question count defaults to 10).', request: 'CreateInterviewRequest', response: 'InterviewDetail', status: 201, errors: ['UNAUTHENTICATED', 'VALIDATION_ERROR'] },
  { method: 'get', path: '/interviews', tag: 'Interviews', auth: 'recruiter', summary: 'Lists and searches the recruiter’s interviews with dashboard stats.', query: 'ListInterviewsQuery', response: 'ListInterviewsResponse', errors: ['UNAUTHENTICATED', 'VALIDATION_ERROR'] },
  { method: 'get', path: '/interviews/:id', tag: 'Interviews', auth: 'recruiter', summary: 'Interview detail, including the invitation and live state.', response: 'InterviewDetail', errors: OWNED },
  { method: 'patch', path: '/interviews/:id', tag: 'Interviews', auth: 'recruiter', summary: 'Edits a DRAFT; omitted fields are unchanged and config is merged.', request: 'UpdateInterviewRequest', response: 'InterviewDetail', errors: [...OWNED, 'VALIDATION_ERROR', 'CONFLICT'] },
  { method: 'delete', path: '/interviews/:id', tag: 'Interviews', auth: 'recruiter', summary: 'Deletes a DRAFT and its questions.', response: null, status: 204, errors: [...OWNED, 'CONFLICT'] },
  { method: 'post', path: '/interviews/:id/cancel', tag: 'Interviews', auth: 'recruiter', summary: 'Cancels an unfinished interview: revokes candidate access, stops recording, keeps saved answers.', response: 'InterviewDetail', errors: [...OWNED, 'CONFLICT'] },
  { method: 'post', path: '/interviews/:id/resume', tag: 'Interviews', auth: 'recruiter', summary: 'Uploads a PDF/DOCX resume (max 5 MB) for text extraction; only the text is kept.', upload: { field: 'resume', description: 'PDF or DOCX, up to 5 MB' }, response: 'UploadResumeResponse', errors: [...OWNED, 'VALIDATION_ERROR', 'RESUME_UNSUPPORTED', 'RESUME_UNREADABLE', 'SERVICE_UNAVAILABLE', 'CONFLICT'] },
  { method: 'post', path: '/interviews/:id/ready', tag: 'Interviews', auth: 'recruiter', summary: 'Locks the questions and issues the invitation + access code. Idempotent.', response: 'MarkReadyResponse', errors: [...OWNED, 'VALIDATION_ERROR', 'CONFLICT'] },
  { method: 'get', path: '/interviews/:id/report', tag: 'Evaluation', auth: 'recruiter', summary: 'Report built from persisted answers, evaluations and observations.', response: 'InterviewReport', errors: OWNED },
  { method: 'get', path: '/interviews/:id/export.pdf', tag: 'Evaluation', auth: 'recruiter', summary: 'The report as a downloadable PDF.', response: null, contentType: 'application/pdf', errors: OWNED },

  { method: 'post', path: '/interviews/:id/questions/generate', tag: 'Questions', auth: 'recruiter', summary: 'Generates questions with Grok and saves them as the draft set (count defaults to the configured count).', request: 'GenerateQuestionsRequest', response: 'GenerateQuestionsResponse', errors: [...OWNED, 'VALIDATION_ERROR', 'PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'CONFLICT'] },
  { method: 'patch', path: '/interviews/:id/questions', tag: 'Questions', auth: 'recruiter', summary: 'Saves the approved questions; array order is the interview order.', request: 'UpdateQuestionsRequest', response: 'UpdateQuestionsResponse', errors: [...OWNED, 'VALIDATION_ERROR', 'CONFLICT'] },

  { method: 'post', path: '/interviews/:id/evaluate', tag: 'Evaluation', auth: 'recruiter', summary: 'Starts or re-runs rubric evaluation in the background; repeating while it runs is a no-op.', response: 'EvaluateResponse', status: 202, errors: [...OWNED, 'PROVIDER_UNAVAILABLE', 'CONFLICT'] },
  { method: 'patch', path: '/evaluations/:id/review', tag: 'Evaluation', auth: 'recruiter', summary: 'Confirms or overrides an AI score (the original score is kept).', request: 'ReviewEvaluationRequest', response: 'Evaluation', errors: [...OWNED, 'VALIDATION_ERROR'] },

  { method: 'post', path: '/interviews/:id/media-token', tag: 'Media', auth: 'mediaToken', summary: 'Issues a short-lived, role-scoped LiveKit token (recruiter viewer, candidate laptop, or paired phone).', request: 'MediaTokenRequest', response: 'MediaTokenResponse', errors: ['UNAUTHENTICATED', 'SESSION_EXPIRED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR', 'MEDIA_NOT_CONFIGURED', 'CONFLICT'] },
  { method: 'post', path: '/webhooks/livekit/egress', tag: 'Media', auth: 'webhook', summary: 'LiveKit webhook (signed with the LiveKit API secret); processed once per delivery id.', response: null, errors: ['UNAUTHENTICATED', 'MEDIA_NOT_CONFIGURED', 'VALIDATION_ERROR'] },

  { method: 'get', path: '/interviews/:id/recordings', tag: 'Recordings', auth: 'recruiter', summary: 'Recording metadata; reconciles with LiveKit when webhooks are delayed.', response: 'ListRecordingsResponse', errors: OWNED },
  { method: 'post', path: '/interviews/:id/recordings/start', tag: 'Recordings', auth: 'recruiter', summary: 'Retries starting the recording during an in-progress, consented interview.', response: 'ListRecordingsResponse', errors: [...OWNED, 'RECORDING_UNAVAILABLE', 'CONSENT_REQUIRED', 'CONFLICT'] },
  { method: 'post', path: '/recordings/:recordingId/playback-url', tag: 'Recordings', auth: 'recruiter', summary: 'Short-lived signed R2 URL, issued after an ownership check (never cached or logged).', response: 'PlaybackUrlResponse', errors: [...OWNED, 'RECORDING_NOT_READY', 'RECORDING_DELETED', 'RECORDING_UNAVAILABLE'] },
  { method: 'delete', path: '/recordings/:recordingId', tag: 'Recordings', auth: 'recruiter', summary: 'Deletes the R2 object, then marks the recording DELETED.', response: 'Recording', errors: [...OWNED, 'CONFLICT', 'RECORDING_UNAVAILABLE', 'RECORDING_DELETE_FAILED'] },

  { method: 'post', path: '/interviews/:id/events', tag: 'Proctoring', auth: 'candidate', summary: 'Logs an observation for human review during the interview (never a verdict).', request: 'CreateProctoringEventRequest', response: 'ProctoringEvent', status: 201, errors: [...CANDIDATE, 'VALIDATION_ERROR', 'CONFLICT'] },
  { method: 'patch', path: '/proctoring-events/:id/review', tag: 'Proctoring', auth: 'recruiter', summary: 'Sets an observation’s review status and note.', request: 'ReviewProctoringEventRequest', response: 'ProctoringEvent', errors: [...OWNED, 'VALIDATION_ERROR'] },
];
