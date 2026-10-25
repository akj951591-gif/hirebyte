import { appConfig } from '@/config/app.config';
import type {
  CandidateAccessRequest,
  CandidateAccessResponse,
  CandidateSessionView,
  CompleteSessionResponse,
  ConsentRequest,
  ConsentResponse,
  CreateInterviewRequest,
  CurrentQuestionResponse,
  EvaluateResponse,
  Evaluation,
  GenerateQuestionsRequest,
  GenerateQuestionsResponse,
  InterviewDetail,
  InterviewReport,
  ListInterviewsQuery,
  ListInterviewsResponse,
  ListRecordingsResponse,
  MarkReadyResponse,
  MeResponse,
  PlaybackUrlResponse,
  ProctoringEvent,
  RecruiterLoginRequest,
  RecruiterLoginResponse,
  ReviewEvaluationRequest,
  ReviewProctoringEventRequest,
  CreateProctoringEventRequest,
  AskInterviewerRequest,
  AskInterviewerResponse,
  ConversationResponse,
  MediaTokenRequest,
  MediaTokenResponse,
  PhoneProctoringEventRequest,
  SkipQuestionRequest,
  SubmitAnswerRequest,
  UpdateInterviewRequest,
  UpdateQuestionsRequest,
  UpdateQuestionsResponse,
  UploadResumeResponse,
} from '../generated/contract';
import { buildUrl, createFetchTransport, type RequestOptions, type Transport } from './http';

export { ApiError, isApiError } from './http';
export type * from '../generated/contract';

// The fixture transport is loaded lazily. The env check is inlined (not featureFlags) so the bundler
// can see it is constant and drop the fixture chunk from non-fixture builds entirely.
const transportReady: Promise<Transport> = import.meta.env.VITE_USE_FIXTURES === 'true'
  ? import('./mockTransport').then((m) => m.mockTransport)
  : Promise.resolve(createFetchTransport(appConfig.apiBaseUrl));

async function request<T>(options: RequestOptions): Promise<T> {
  const transport = await transportReady;
  return transport.request<T>(options);
}

const enc = encodeURIComponent;

/**
 * The single typed API client (PRD §5, §6.1.4). Pages and features call these functions; no
 * page-local fetch calls. Routes follow the PRD §11 baseline.
 */
export const api = {
  auth: {
    recruiterLogin: (body: RecruiterLoginRequest) =>
      request<RecruiterLoginResponse>({ method: 'POST', path: '/auth/recruiter/login', body }),
    recruiterLogout: () => request<void>({ method: 'POST', path: '/auth/recruiter/logout' }),
    me: (signal?: AbortSignal) => request<MeResponse>({ method: 'GET', path: '/auth/me', signal }),
  },

  candidate: {
    access: (body: CandidateAccessRequest) =>
      request<CandidateAccessResponse>({ method: 'POST', path: '/candidate/access', body }),
    logout: () => request<void>({ method: 'POST', path: '/candidate/logout' }),
    getSession: (sessionId: string, signal?: AbortSignal) =>
      request<CandidateSessionView>({ method: 'GET', path: `/candidate/sessions/${enc(sessionId)}`, signal }),
    consent: (sessionId: string, body: ConsentRequest) =>
      request<ConsentResponse>({ method: 'POST', path: `/candidate/sessions/${enc(sessionId)}/consent`, body }),
    start: (sessionId: string) =>
      request<CurrentQuestionResponse>({ method: 'POST', path: `/candidate/sessions/${enc(sessionId)}/start` }),
    currentQuestion: (sessionId: string, signal?: AbortSignal) =>
      request<CurrentQuestionResponse>({
        method: 'GET',
        path: `/candidate/sessions/${enc(sessionId)}/current-question`,
        signal,
      }),
    submitAnswer: (sessionId: string, body: SubmitAnswerRequest) =>
      request<CurrentQuestionResponse>({ method: 'POST', path: `/candidate/sessions/${enc(sessionId)}/answers`, body }),
    skip: (sessionId: string, body: SkipQuestionRequest) =>
      request<CurrentQuestionResponse>({ method: 'POST', path: `/candidate/sessions/${enc(sessionId)}/skip`, body }),
    complete: (sessionId: string) =>
      request<CompleteSessionResponse>({ method: 'POST', path: `/candidate/sessions/${enc(sessionId)}/complete` }),
    /** Everything the AI interviewer and the candidate have said so far. */
    conversation: (sessionId: string, signal?: AbortSignal) =>
      request<ConversationResponse>({ method: 'GET', path: `/candidate/sessions/${enc(sessionId)}/conversation`, signal }),
    /** Ask the interviewer about the current question; it clarifies but never gives the answer. */
    ask: (sessionId: string, body: AskInterviewerRequest) =>
      request<AskInterviewerResponse>({ method: 'POST', path: `/candidate/sessions/${enc(sessionId)}/ask`, body }),
  },

  interviews: {
    list: (query: ListInterviewsQuery = {}, signal?: AbortSignal) =>
      request<ListInterviewsResponse>({
        method: 'GET',
        path: '/interviews',
        query: { search: query.search, status: query.status },
        signal,
      }),
    get: (id: string, signal?: AbortSignal) =>
      request<InterviewDetail>({ method: 'GET', path: `/interviews/${enc(id)}`, signal }),
    create: (body: CreateInterviewRequest) => request<InterviewDetail>({ method: 'POST', path: '/interviews', body }),
    /** Draft only; omitted fields stay unchanged and `config` is merged. */
    update: (id: string, body: UpdateInterviewRequest) =>
      request<InterviewDetail>({ method: 'PATCH', path: `/interviews/${enc(id)}`, body }),
    /** Draft only. Issued interviews are cancelled instead. */
    remove: (id: string) => request<void>({ method: 'DELETE', path: `/interviews/${enc(id)}` }),
    /** Ends candidate access and stops any recording; saved answers are kept. */
    cancel: (id: string) => request<InterviewDetail>({ method: 'POST', path: `/interviews/${enc(id)}/cancel` }),
    uploadResume: (id: string, file: File) => {
      const form = new FormData();
      form.append('resume', file);
      return request<UploadResumeResponse>({ method: 'POST', path: `/interviews/${enc(id)}/resume`, body: form });
    },
    generateQuestions: (id: string, body: GenerateQuestionsRequest) =>
      request<GenerateQuestionsResponse>({ method: 'POST', path: `/interviews/${enc(id)}/questions/generate`, body }),
    updateQuestions: (id: string, body: UpdateQuestionsRequest) =>
      request<UpdateQuestionsResponse>({ method: 'PATCH', path: `/interviews/${enc(id)}/questions`, body }),
    markReady: (id: string) => request<MarkReadyResponse>({ method: 'POST', path: `/interviews/${enc(id)}/ready` }),
    evaluate: (id: string) => request<EvaluateResponse>({ method: 'POST', path: `/interviews/${enc(id)}/evaluate` }),
    report: (id: string, signal?: AbortSignal) =>
      request<InterviewReport>({ method: 'GET', path: `/interviews/${enc(id)}/report`, signal }),
    /** Browser navigates here directly so the cookie-authenticated download is handled natively. */
    exportPdfUrl: (id: string) => buildUrl(appConfig.apiBaseUrl, `/interviews/${enc(id)}/export.pdf`),
  },

  recordings: {
    list: (interviewId: string, signal?: AbortSignal) =>
      request<ListRecordingsResponse>({ method: 'GET', path: `/interviews/${enc(interviewId)}/recordings`, signal }),
    playbackUrl: (recordingId: string) =>
      request<PlaybackUrlResponse>({ method: 'POST', path: `/recordings/${enc(recordingId)}/playback-url` }),
  },

  evaluations: {
    review: (evaluationId: string, body: ReviewEvaluationRequest) =>
      request<Evaluation>({ method: 'PATCH', path: `/evaluations/${enc(evaluationId)}/review`, body }),
  },

  media: {
    /** Short-lived LiveKit token; the cookie (recruiter/candidate) or the phone's pairing/device token decides the role. */
    token: (interviewId: string, body: MediaTokenRequest) =>
      request<MediaTokenResponse>({ method: 'POST', path: `/interviews/${enc(interviewId)}/media-token`, body }),
  },

  proctoring: {
    /** Paired phone: observation from the phone camera, authorised by its device token. */
    logFromPhone: (interviewId: string, body: PhoneProctoringEventRequest) =>
      request<ProctoringEvent>({ method: 'POST', path: `/interviews/${enc(interviewId)}/phone-events`, body }),
    /** Candidate laptop: an observation from the camera or tab checks (candidate session cookie). */
    log: (interviewId: string, body: CreateProctoringEventRequest) =>
      request<ProctoringEvent>({ method: 'POST', path: `/interviews/${enc(interviewId)}/events`, body }),
    review: (eventId: string, body: ReviewProctoringEventRequest) =>
      request<ProctoringEvent>({ method: 'PATCH', path: `/proctoring-events/${enc(eventId)}/review`, body }),
  },
};

export type Api = typeof api;
