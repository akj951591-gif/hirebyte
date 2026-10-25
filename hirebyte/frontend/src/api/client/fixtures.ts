/**
 * FIXTURE DATA — isolated UI development only (PRD §6.1.6).
 *
 * Seed data for the in-browser fixture transport (mockTransport.ts). Nothing here is real: no real
 * people, credentials, recordings or AI output. Remove/replace before integration acceptance.
 * Demo sign-in values for fixture mode are documented in frontend/README.md.
 */
import type {
  CandidateQuestion,
  Difficulty,
  Evaluation,
  InterviewConfig,
  InterviewDetail,
  InterviewStatus,
  OverallAssessment,
  ProctoringEvent,
  Question,
  QuestionCategory,
  Recording,
  RecordingStatus,
  ReportAnswer,
  SafeUser,
} from '../generated/contract';

export const FIXTURE_RECRUITER: SafeUser = {
  id: 'usr_fixture_recruiter',
  email: 'recruiter@hirebyte.test',
  name: 'Demo Recruiter',
  role: 'RECRUITER',
};
export const FIXTURE_RECRUITER_PASSWORD = 'HireByte-demo-2026';

/** Invitation codes that always return a specific error, so every login state can be exercised. */
export const FIXTURE_SPECIAL_CODES: Record<string, { code: string; status: number; message: string }> = {
  'HB-EXPIRED-01': {
    code: 'INVITATION_EXPIRED',
    status: 410,
    message: 'This invitation has expired. Ask the recruiter to send you a new one.',
  },
  'HB-DONE-0001': {
    code: 'INTERVIEW_COMPLETED',
    status: 409,
    message: 'This interview has already been completed.',
  },
  'HB-LOCKED-01': {
    code: 'SESSION_LOCKED',
    status: 423,
    message: 'This interview session is locked after too many attempts.',
  },
  'HB-ERROR-500': {
    code: 'SERVICE_UNAVAILABLE',
    status: 503,
    message: 'The interview service is temporarily unavailable.',
  },
};

export const RECORDING_NOTICE_VERSION = 'rec-notice-2026-10';
export const PROCTORING_NOTICE_VERSION = 'proc-notice-2026-10';

interface BankItem {
  text: string;
  category: QuestionCategory;
  difficulty: Difficulty;
  skills: string[];
  criteria: string[];
  points: string[];
}

export const QUESTION_BANK: BankItem[] = [
  {
    text: 'Walk me through how you would structure state in a large React application. When would you reach for a global store?',
    category: 'TECHNICAL',
    difficulty: 'MEDIUM',
    skills: ['React', 'State management'],
    criteria: ['Explains local vs global state trade-offs', 'Names concrete patterns or tools', 'Considers re-render cost'],
    points: ['Keep state close to where it is used', 'Separate server cache from client state', 'Use selectors or memoization for hot paths'],
  },
  {
    text: 'How does the browser render a page, and how would you diagnose a slow first paint?',
    category: 'TECHNICAL',
    difficulty: 'MEDIUM',
    skills: ['Web performance'],
    criteria: ['Describes the critical rendering path', 'Uses measurement before optimising', 'Proposes specific fixes'],
    points: ['Parse HTML and CSS into a render tree', 'Profile with performance tooling', 'Defer non-critical scripts and inline critical CSS'],
  },
  {
    text: 'Tell me about a time you disagreed with a technical decision on your team. What did you do?',
    category: 'BEHAVIORAL',
    difficulty: 'EASY',
    skills: ['Communication', 'Collaboration'],
    criteria: ['Gives a specific situation', 'Shows respectful disagreement', 'Describes the outcome and learning'],
    points: ['Raised concerns with data', 'Listened to the other view', 'Agreed on an experiment or compromise'],
  },
  {
    text: 'How would you design a REST endpoint that is safe to retry? How do you prevent duplicate writes?',
    category: 'TECHNICAL',
    difficulty: 'MEDIUM',
    skills: ['API design', 'Node.js'],
    criteria: ['Mentions idempotency keys or natural keys', 'Discusses status codes', 'Handles concurrent retries'],
    points: ['Accept an idempotency key from the client', 'Store the first result and replay it', 'Use a unique constraint to stop races'],
  },
  {
    text: 'Design a service that sends interview reminders to thousands of candidates. What components do you need and how do you handle failures?',
    category: 'SYSTEM_DESIGN',
    difficulty: 'HARD',
    skills: ['System design', 'Queues'],
    criteria: ['Identifies scheduling and delivery components', 'Handles retries and dead letters', 'Considers rate limits and observability'],
    points: ['Scheduler enqueues reminder jobs', 'Workers send through a provider with retries', 'Track delivery status and alert on failures'],
  },
  {
    text: 'Your resume mentions migrating a project to TypeScript. What was the hardest part, and what would you do differently?',
    category: 'RESUME',
    difficulty: 'MEDIUM',
    skills: ['TypeScript'],
    criteria: ['Describes a concrete challenge', 'Explains the migration strategy', 'Reflects honestly on improvements'],
    points: ['Migrated incrementally file by file', 'Typed the API boundary first', 'Would enable strict mode earlier'],
  },
  {
    text: 'A production bug is reported an hour before a release. How do you decide whether to delay the release?',
    category: 'SITUATIONAL',
    difficulty: 'MEDIUM',
    skills: ['Ownership', 'Risk assessment'],
    criteria: ['Assesses impact and severity', 'Involves the right people', 'Has a rollback or mitigation plan'],
    points: ['Check how many users are affected', 'Talk to the release owner', 'Ship behind a flag or delay with a clear plan'],
  },
  {
    text: 'What is the difference between authentication and authorization, and where should each be enforced in a web app?',
    category: 'TECHNICAL',
    difficulty: 'EASY',
    skills: ['Security'],
    criteria: ['Defines both correctly', 'Enforces authorization on the server', 'Mentions least privilege'],
    points: ['Authentication proves identity', 'Authorization checks what an identity may do', 'Every protected API request is checked server-side'],
  },
  {
    text: 'How would you write SQL to find the top three products by revenue for each month? Which indexes would help?',
    category: 'TECHNICAL',
    difficulty: 'MEDIUM',
    skills: ['SQL', 'Data modeling'],
    criteria: ['Uses window functions or an equivalent', 'Groups by month correctly', 'Justifies index choice'],
    points: ['Aggregate revenue by month and product', 'Rank with ROW_NUMBER partitioned by month', 'Index on order date and product id'],
  },
  {
    text: 'Describe a project where requirements changed late. How did you adapt?',
    category: 'BEHAVIORAL',
    difficulty: 'EASY',
    skills: ['Adaptability'],
    criteria: ['Gives a specific example', 'Explains prioritisation', 'Shows communication with stakeholders'],
    points: ['Re-scoped with the product owner', 'Cut lower-value work', 'Kept stakeholders updated on trade-offs'],
  },
  {
    text: 'How would you set up a CI pipeline for a service with unit and integration tests? What would you gate merges on?',
    category: 'TECHNICAL',
    difficulty: 'MEDIUM',
    skills: ['CI/CD', 'Testing'],
    criteria: ['Orders pipeline stages sensibly', 'Chooses meaningful merge gates', 'Keeps the pipeline fast'],
    points: ['Lint and typecheck first', 'Run unit tests then integration tests against a test database', 'Block merges on failures and required reviews'],
  },
  {
    text: 'Explain how you would roll out a database schema change with zero downtime.',
    category: 'TECHNICAL',
    difficulty: 'HARD',
    skills: ['Databases', 'DevOps'],
    criteria: ['Uses expand and contract steps', 'Keeps old and new code compatible', 'Plans backfill and rollback'],
    points: ['Add new columns without removing old ones', 'Deploy code that writes both', 'Backfill, switch reads, then drop old columns'],
  },
  {
    text: 'You are asked to check a page for accessibility before handoff. What do you look at first?',
    category: 'SITUATIONAL',
    difficulty: 'EASY',
    skills: ['Accessibility'],
    criteria: ['Mentions keyboard navigation', 'Checks contrast and labels', 'Uses assistive technology or audits'],
    points: ['Tab through every control', 'Check labels, headings and contrast', 'Run an audit tool and a screen reader pass'],
  },
  {
    text: 'How do containers differ from virtual machines, and when would you choose Kubernetes?',
    category: 'TECHNICAL',
    difficulty: 'MEDIUM',
    skills: ['Docker', 'Kubernetes'],
    criteria: ['Explains isolation differences', 'Knows when orchestration is worth it', 'Mentions operational cost'],
    points: ['Containers share the host kernel', 'VMs virtualise hardware', 'Kubernetes helps when running many services with scaling needs'],
  },
];

let idCounter = 0;
export function fixtureId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function bankToQuestion(item: BankItem, interviewId: string, sequence: number, id?: string): Question {
  return {
    id: id ?? `${interviewId}_q${sequence}`,
    sequence,
    text: item.text,
    category: item.category,
    difficulty: item.difficulty,
    targetSkills: item.skills,
    evaluationCriteria: item.criteria,
    expectedAnswerPoints: item.points,
    source: 'AI_GENERATED',
  };
}

export function toCandidateQuestion(question: Question): CandidateQuestion {
  return { id: question.id, sequence: question.sequence, text: question.text, category: question.category, isFollowUp: question.source === 'FOLLOW_UP' };
}

/** Builds a fixture question set; `skills` are woven into skill-based questions past the bank size. */
export function generateFixtureQuestions(
  interviewId: string,
  count: number,
  categories: QuestionCategory[],
  skills: string[],
): Question[] {
  const preferred = QUESTION_BANK.filter((q) => categories.length === 0 || categories.includes(q.category));
  const rest = QUESTION_BANK.filter((q) => !preferred.includes(q));
  const ordered = [...preferred, ...rest];
  const questions: Question[] = [];
  for (let i = 0; i < count; i += 1) {
    const seq = i + 1;
    if (i < ordered.length) {
      questions.push(bankToQuestion(ordered[i], interviewId, seq, fixtureId('q')));
      continue;
    }
    const skill = skills[(i - ordered.length) % Math.max(skills.length, 1)] ?? 'your core stack';
    questions.push({
      id: fixtureId('q'),
      sequence: seq,
      text: `Describe a recent piece of work where you used ${skill}. What would you improve if you did it again? (#${seq})`,
      category: 'RESUME',
      difficulty: 'MEDIUM',
      targetSkills: [skill],
      evaluationCriteria: ['Gives a concrete example', 'Explains their own contribution', 'Reflects on improvements'],
      expectedAnswerPoints: ['Context and goal', 'Specific actions taken', 'Measured outcome and lesson'],
      source: 'AI_GENERATED',
    });
  }
  return questions;
}

export function fixtureTranscript(question: Question): string {
  const [first, second, third] = question.expectedAnswerPoints;
  return [
    first && `I would start by making sure we ${first.charAt(0).toLowerCase()}${first.slice(1)}.`,
    second && `After that, I'd ${second.charAt(0).toLowerCase()}${second.slice(1)}.`,
    third && `In my last project we also chose to ${third.charAt(0).toLowerCase()}${third.slice(1)}, which worked well for the team.`,
  ]
    .filter(Boolean)
    .join(' ');
}

export function fixtureEvaluation(question: Question, transcript: string, score: number): Evaluation {
  const maxScore = 10;
  const per = question.evaluationCriteria.length || 1;
  const firstSentence = transcript.split('. ')[0]?.replace(/\.$/, '') ?? transcript;
  return {
    id: `ev_${question.id}`,
    questionId: question.id,
    score,
    maxScore,
    criteria: question.evaluationCriteria.map((criterion, i) => ({
      criterion,
      score: Math.max(0, Math.min(10, Math.round(score + (i === 0 ? 1 : i === per - 1 ? -1 : 0)))),
      maxScore: 10,
    })),
    evidence: [`"${firstSentence}."`],
    explanation:
      score >= 7
        ? 'The answer covers the main expected points with a concrete example.'
        : score >= 5
          ? 'The answer addresses the question but stays general on some criteria.'
          : 'The answer misses several expected points and gives little supporting detail.',
    strengths: score >= 6 ? [`Clear on ${question.targetSkills[0] ?? 'the topic'}`] : [],
    gaps: score < 8 ? [`Could go deeper on: ${question.evaluationCriteria[question.evaluationCriteria.length - 1]}`] : [],
    reviewStatus: 'AI_ONLY',
    override: null,
  };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

const baseConfig: InterviewConfig = {
  questionCount: 10,
  durationMinutes: 30,
  difficulty: 'MEDIUM',
  experienceLevel: 'MID',
  categories: ['TECHNICAL', 'BEHAVIORAL'],
  allowSkip: true,
  allowFollowUps: false,
  maxFollowUps: 0,
  secondaryCamera: 'OPTIONAL',
  recordingEnabled: true,
};

interface SeedInterview {
  id: string;
  jobTitle: string;
  candidateName: string;
  candidateEmail: string;
  status: InterviewStatus;
  bank: number[];
  skills: string[];
  config?: Partial<InterviewConfig>;
  createdHoursAgo: number;
  startedHoursAgo?: number;
  durationMin?: number;
  recording: RecordingStatus;
  recordingFailure?: string;
  /** Per-question scores (null = unanswered). Presence means answers exist. */
  scores?: (number | null)[];
  answeredCount?: number;
  evaluated?: boolean;
  reviewed?: boolean;
  evaluationFailure?: string;
  invitationCode?: string;
  accessCode?: string;
}

const SEEDS: SeedInterview[] = [
  {
    id: 'int_1001',
    jobTitle: 'Senior Frontend Engineer',
    candidateName: 'Aarav Mehta',
    candidateEmail: 'aarav.mehta@example.test',
    status: 'EVALUATED',
    bank: [0, 1, 2, 5, 12, 6],
    skills: ['React', 'TypeScript', 'Web performance', 'Accessibility'],
    createdHoursAgo: 30,
    startedHoursAgo: 26,
    durationMin: 28,
    recording: 'READY',
    scores: [8, 7, 7, 8, 6, null],
    evaluated: true,
  },
  {
    id: 'int_1002',
    jobTitle: 'Backend Engineer (Node.js)',
    candidateName: 'Sara Iqbal',
    candidateEmail: 'sara.iqbal@example.test',
    status: 'IN_PROGRESS',
    bank: [3, 7, 4, 10, 11, 2, 9, 6],
    skills: ['Node.js', 'PostgreSQL', 'API design'],
    createdHoursAgo: 5,
    startedHoursAgo: 0.2,
    recording: 'RECORDING',
    answeredCount: 3,
  },
  {
    id: 'int_1003',
    jobTitle: 'Software Engineer',
    candidateName: 'Demo Candidate',
    candidateEmail: 'candidate@example.test',
    status: 'READY',
    bank: [7, 3, 2, 6, 10],
    skills: ['JavaScript', 'APIs', 'Testing'],
    config: { questionCount: 5, durationMinutes: 20, secondaryCamera: 'OPTIONAL', recordingEnabled: true },
    createdHoursAgo: 2,
    recording: 'NOT_ENABLED',
    invitationCode: 'HB-DEMO-0001',
    accessCode: '246810',
  },
  {
    id: 'int_1004',
    jobTitle: 'Data Analyst',
    candidateName: 'Rohan Das',
    candidateEmail: 'rohan.das@example.test',
    status: 'COMPLETED',
    bank: [8, 9, 2, 6, 12, 7],
    skills: ['SQL', 'Data modeling', 'Communication'],
    config: { secondaryCamera: 'OFF' },
    createdHoursAgo: 20,
    startedHoursAgo: 3,
    durationMin: 24,
    recording: 'FINALIZING',
    scores: [6, 7, null, 5, 6, 7],
  },
  {
    id: 'int_1005',
    jobTitle: 'DevOps Engineer',
    candidateName: 'Meera Nair',
    candidateEmail: 'meera.nair@example.test',
    status: 'EVALUATION_FAILED',
    bank: [13, 11, 10, 4, 6, 2],
    skills: ['Docker', 'Kubernetes', 'CI/CD'],
    createdHoursAgo: 50,
    startedHoursAgo: 46,
    durationMin: 31,
    recording: 'FAILED',
    recordingFailure: 'EGRESS_START_FAILED',
    scores: [7, 6, 7, 5, 6, 7],
    evaluationFailure: 'PROVIDER_TIMEOUT',
  },
  {
    id: 'int_1006',
    jobTitle: 'Product Designer',
    candidateName: 'Ananya Rao',
    candidateEmail: 'ananya.rao@example.test',
    status: 'DRAFT',
    bank: [],
    skills: ['Figma', 'User research', 'Accessibility'],
    config: { categories: ['BEHAVIORAL', 'SITUATIONAL'] },
    createdHoursAgo: 1,
    recording: 'NOT_ENABLED',
  },
  {
    id: 'int_1007',
    jobTitle: 'QA Engineer',
    candidateName: 'Kabir Singh',
    candidateEmail: 'kabir.singh@example.test',
    status: 'REVIEWED',
    bank: [10, 12, 6, 2, 9],
    skills: ['Testing', 'Automation'],
    createdHoursAgo: 120,
    startedHoursAgo: 118,
    durationMin: 22,
    recording: 'DELETED',
    scores: [6, 5, 7, 6, 6],
    evaluated: true,
    reviewed: true,
  },
  {
    id: 'int_1008',
    jobTitle: 'Senior Frontend Engineer',
    candidateName: 'Isha Kapoor',
    candidateEmail: 'isha.kapoor@example.test',
    status: 'REVIEWED',
    bank: [0, 1, 5, 12, 2],
    skills: ['React', 'TypeScript'],
    config: { recordingEnabled: false },
    createdHoursAgo: 72,
    startedHoursAgo: 70,
    durationMin: 26,
    recording: 'NOT_ENABLED',
    scores: [9, 8, 8, 7, 9],
    evaluated: true,
    reviewed: true,
  },
];

export interface FixtureEvaluationState {
  status: 'NOT_STARTED' | 'EVALUATING' | 'EVALUATED' | 'FAILED';
  failureCode: string | null;
  requestedAt: number | null;
}

export interface FixtureSession {
  sessionId: string;
  interviewId: string;
  consent: { recordingConsent: boolean; proctoringConsent: boolean; consentedAt: string } | null;
  pairingStatus: 'NOT_PAIRED' | 'PAIRED' | 'DISCONNECTED' | 'EXPIRED';
  submittedKeys: string[];
  completedAt: string | null;
}

export interface FixtureState {
  version: 3;
  recruiterSignedIn: boolean;
  failedRecruiterLogins: number;
  failedAccessAttempts: number;
  /** Simulates the HttpOnly candidate session cookie. */
  candidateSessionId: string | null;
  interviews: InterviewDetail[];
  answers: Record<string, Record<string, ReportAnswer>>;
  evaluations: Record<string, Record<string, Evaluation>>;
  overall: Record<string, OverallAssessment | null>;
  evaluation: Record<string, FixtureEvaluationState>;
  events: Record<string, ProctoringEvent[]>;
  recordings: Record<string, Recording[]>;
  sessions: Record<string, FixtureSession>;
}

export function overallFrom(evaluations: Evaluation[]): OverallAssessment | null {
  const scored = evaluations.filter((e) => e.score !== null);
  if (scored.length === 0) return null;
  const effective = scored.map((e) => e.override?.score ?? (e.score as number));
  const avg = Math.round((effective.reduce((a, b) => a + b, 0) / effective.length) * 10) / 10;
  return {
    score: avg,
    maxScore: 10,
    summary:
      avg >= 7.5
        ? 'Strong, specific answers across most job-related criteria, with concrete examples from past work.'
        : avg >= 6
          ? 'Solid fundamentals with some answers that stayed general. Worth a focused follow-up on the gaps listed.'
          : 'Several answers missed expected points. Review the transcripts before deciding on next steps.',
    strengths: Array.from(new Set(scored.flatMap((e) => e.strengths))).slice(0, 4),
    gaps: Array.from(new Set(scored.flatMap((e) => e.gaps))).slice(0, 4),
  };
}

export function createSeedState(): FixtureState {
  const state: FixtureState = {
    version: 3,
    recruiterSignedIn: false,
    failedRecruiterLogins: 0,
    failedAccessAttempts: 0,
    candidateSessionId: null,
    interviews: [],
    answers: {},
    evaluations: {},
    overall: {},
    evaluation: {},
    events: {},
    recordings: {},
    sessions: {},
  };

  for (const seed of SEEDS) {
    const config: InterviewConfig = { ...baseConfig, ...seed.config };
    const questions = seed.bank.map((b, i) => bankToQuestion(QUESTION_BANK[b], seed.id, i + 1));
    if (seed.bank.length > 0 && !seed.config?.questionCount) config.questionCount = questions.length;
    const startedAt = seed.startedHoursAgo !== undefined ? hoursAgo(seed.startedHoursAgo) : null;
    const endedAt =
      startedAt && seed.durationMin && seed.status !== 'IN_PROGRESS'
        ? new Date(new Date(startedAt).getTime() + seed.durationMin * 60_000).toISOString()
        : null;

    // Answers
    const answers: Record<string, ReportAnswer> = {};
    questions.forEach((q, i) => {
      const scored = seed.scores?.[i];
      const answeredLive = seed.answeredCount !== undefined && i < seed.answeredCount;
      if (seed.scores === undefined && !answeredLive) return;
      const unanswered = seed.scores !== undefined && scored === null;
      answers[q.id] = {
        id: `ans_${q.id}`,
        status: unanswered ? 'SKIPPED' : 'ANSWERED',
        transcript: unanswered ? '' : fixtureTranscript(q),
        durationSeconds: unanswered ? null : 70 + ((i * 37) % 90),
        inputMode: unanswered ? null : 'VOICE',
        submittedAt: startedAt ? new Date(new Date(startedAt).getTime() + (i + 1) * 4 * 60_000).toISOString() : null,
      };
    });
    state.answers[seed.id] = answers;

    // Evaluations
    const evaluations: Record<string, Evaluation> = {};
    if (seed.evaluated && seed.scores) {
      questions.forEach((q, i) => {
        const score = seed.scores?.[i];
        if (score === null || score === undefined) return;
        const ev = fixtureEvaluation(q, answers[q.id].transcript, score);
        if (seed.reviewed) ev.reviewStatus = 'CONFIRMED';
        evaluations[q.id] = ev;
      });
    }
    state.evaluations[seed.id] = evaluations;
    state.overall[seed.id] = seed.evaluated ? overallFrom(Object.values(evaluations)) : null;
    state.evaluation[seed.id] = {
      status: seed.evaluated ? 'EVALUATED' : seed.evaluationFailure ? 'FAILED' : 'NOT_STARTED',
      failureCode: seed.evaluationFailure ?? null,
      requestedAt: null,
    };

    // Proctoring observations
    const events: ProctoringEvent[] = [];
    if (startedAt && seed.id === 'int_1001') {
      events.push(
        {
          id: `pe_${seed.id}_1`,
          type: 'FACE_ABSENT',
          occurredAt: new Date(new Date(startedAt).getTime() + 7 * 60_000).toISOString(),
          durationSeconds: 6,
          sourceCamera: 'PRIMARY',
          description: 'No face detected in the primary camera for about 6 seconds.',
          reviewStatus: 'UNREVIEWED',
          reviewerNote: null,
        },
        {
          id: `pe_${seed.id}_2`,
          type: 'SECONDARY_DISCONNECTED',
          occurredAt: new Date(new Date(startedAt).getTime() + 15 * 60_000).toISOString(),
          durationSeconds: 40,
          sourceCamera: 'SECONDARY',
          description: 'Phone camera disconnected and reconnected after about 40 seconds.',
          reviewStatus: 'NO_CONCERN',
          reviewerNote: 'Candidate mentioned a Wi-Fi drop; reconnected on their own.',
        },
      );
    }
    if (seed.id === 'int_1002') {
      events.push({
        id: `pe_${seed.id}_1`,
        type: 'LOOKING_AWAY',
        occurredAt: minutesAgo(4),
        durationSeconds: 9,
        sourceCamera: 'PRIMARY',
        description: 'Candidate looked away from the screen for about 9 seconds.',
        reviewStatus: 'UNREVIEWED',
        reviewerNote: null,
      });
    }
    state.events[seed.id] = events;

    // Recording metadata
    state.recordings[seed.id] =
      seed.recording === 'NOT_ENABLED'
        ? []
        : [
            {
              id: `rec_${seed.id}`,
              interviewId: seed.id,
              status: seed.recording,
              mimeType: seed.recording === 'READY' ? 'video/mp4' : null,
              sizeBytes: seed.recording === 'READY' ? 184_000_000 : null,
              durationSeconds: seed.recording === 'READY' && seed.durationMin ? seed.durationMin * 60 : null,
              startedAt,
              completedAt: seed.recording === 'READY' || seed.recording === 'DELETED' ? endedAt : null,
              failureCode: seed.recordingFailure ?? null,
            },
          ];

    const answeredCount = Object.values(answers).filter((a) => a.status === 'ANSWERED').length;
    const skippedCount = Object.values(answers).filter((a) => a.status === 'SKIPPED').length;
    const overall = state.overall[seed.id];

    state.interviews.push({
      id: seed.id,
      jobTitle: seed.jobTitle,
      candidateName: seed.candidateName,
      candidateEmail: seed.candidateEmail,
      status: seed.status,
      questionCount: questions.length || config.questionCount,
      overallScore: overall?.score ?? null,
      maxScore: 10,
      recordingStatus: seed.recording,
      createdAt: hoursAgo(seed.createdHoursAgo),
      startedAt,
      endedAt,
      jobDescription: `We are hiring a ${seed.jobTitle} to join a small product team. You will own features end to end, collaborate with design and product, and help raise the quality bar through reviews and testing. Key skills: ${seed.skills.join(', ')}.`,
      requiredSkills: seed.skills,
      config,
      resume:
        seed.bank.length > 0
          ? {
              id: `res_${seed.id}`,
              filename: `${seed.candidateName.split(' ')[0].toLowerCase()}_resume.pdf`,
              mimeType: 'application/pdf',
              sizeBytes: 182_000,
              extractionStatus: 'COMPLETED',
              failureCode: null,
            }
          : null,
      questions,
      invitation: seed.invitationCode
        ? {
            code: seed.invitationCode,
            accessCode: seed.accessCode ?? '000000',
            url: `/candidate/login?code=${seed.invitationCode}`,
            expiresAt: daysFromNow(3),
          }
        : null,
      live:
        seed.status === 'IN_PROGRESS'
          ? {
              progress: {
                answered: answeredCount,
                skipped: skippedCount,
                total: questions.length,
                currentSequence: answeredCount + skippedCount + 1,
              },
              primaryCamera: 'CONNECTED',
              secondaryCamera: 'CONNECTED',
              recentEvents: events,
              updatedAt: new Date().toISOString(),
            }
          : null,
    });
  }
  return state;
}
