import type { AppDeps } from '../context.js';
import { createAuthService } from './auth/auth.service.js';
import { createCandidateSessionService } from './auth/candidateSession.service.js';
import { createEvaluationService } from './evaluation/evaluation.service.js';
import { createEvaluationRunner } from './evaluation/evaluationRunner.service.js';
import { createPdfService } from './evaluation/pdf.service.js';
import { createReportService } from './evaluation/report.service.js';
import { createCandidateFlowService } from './interviews/answer.service.js';
import { createInterviewService } from './interviews/interview.service.js';
import { createQuestionService } from './interviews/question.service.js';
import { createResumeService } from './interviews/resume.service.js';
import { createMediaService } from './media/media.service.js';
import { createPlaybackService } from './recordings/playback.service.js';
import { createRecordingService } from './recordings/recording.service.js';

export function createServices(deps: AppDeps) {
  const media = createMediaService(deps);
  const recordings = createRecordingService(deps);
  const reports = createReportService(deps);
  return {
    auth: createAuthService(deps),
    candidates: createCandidateSessionService(deps),
    candidateFlow: createCandidateFlowService(deps, recordings, media),
    interviews: createInterviewService(deps, recordings),
    questions: createQuestionService(deps),
    resumes: createResumeService(deps),
    media,
    recordings,
    playback: createPlaybackService(deps),
    reports,
    pdf: createPdfService(reports),
    evaluations: createEvaluationService(deps),
    evaluationRunner: createEvaluationRunner(deps),
  };
}

export type Services = ReturnType<typeof createServices>;
