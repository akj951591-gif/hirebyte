import 'dotenv/config';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import type { AppDeps } from '../../src/context.js';
import { createCrypto } from '../../src/lib/crypto.js';
import { configureLogger } from '../../src/lib/logger.js';
import { createPrisma, type Db } from '../../src/repositories/prisma.js';
import { hashPassword } from '../../src/services/auth/password.js';
import type { Services } from '../../src/services/index.js';
import { FakeDocuments, FakeEgress, FakeLlm, FakeMedia, FakeStorage, FakeWebhooks, RecordingEventHub } from './fakes.js';

configureLogger('error', { silent: true });

let sharedDb: Db | null = null;
export function testDb(): Db {
  sharedDb ??= createPrisma(process.env.TEST_DATABASE_URL!);
  return sharedDb;
}

/** Empties every table (except Prisma's migration history) between tests. */
export async function resetDb(): Promise<void> {
  const db = testDb();
  const rows = await db.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length) await db.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export interface TestAppOptions {
  /** Provide LiveKit/R2 fakes (and fake env values so config validation passes). */
  media?: boolean;
  recordingEnabled?: boolean;
  /** Provide the document service and Grok fakes. */
  ai?: boolean;
  env?: Record<string, string>;
}

export interface TestApp {
  app: Express;
  services: Services;
  deps: AppDeps;
  env: Env;
  media: FakeMedia;
  egress: FakeEgress;
  storage: FakeStorage;
  events: RecordingEventHub;
  documents: FakeDocuments;
  llm: FakeLlm;
  clock: { offsetMs: number };
}

export function buildTestApp(opts: TestAppOptions = {}): TestApp {
  const withMedia = opts.media ?? opts.recordingEnabled ?? false;
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    SESSION_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    APP_BASE_URL: 'http://localhost:5173',
    LIVEKIT_URL: withMedia ? 'wss://fake.livekit.test' : '',
    LIVEKIT_API_KEY: withMedia ? 'fake-key' : '',
    LIVEKIT_API_SECRET: withMedia ? 'fake-secret-fake-secret-fake-secret' : '',
    R2_ACCOUNT_ID: withMedia ? 'fakeaccount' : '',
    R2_ACCESS_KEY_ID: withMedia ? 'fake-access' : '',
    R2_SECRET_ACCESS_KEY: withMedia ? 'fake-r2-secret' : '',
    R2_BUCKET_NAME: withMedia ? 'hirebyte-test' : '',
    R2_ENDPOINT: '',
    RECORDING_ENABLED: opts.recordingEnabled ? 'true' : 'false',
    RECORDING_RETENTION_DAYS: '30',
    ...opts.env,
  });
  const clock = { offsetMs: 0 };
  const media = new FakeMedia();
  const egress = new FakeEgress();
  const storage = new FakeStorage();
  const events = new RecordingEventHub(testDb());
  const documents = new FakeDocuments();
  const llm = new FakeLlm();
  const deps: AppDeps = {
    env,
    db: testDb(),
    crypto: createCrypto(env.SESSION_SECRET),
    media: withMedia ? media : null,
    egress: withMedia ? egress : null,
    storage: withMedia ? storage : null,
    webhooks: withMedia ? new FakeWebhooks() : null,
    events,
    documents: opts.ai ? documents : null,
    llm: opts.ai ? llm : null,
    now: () => new Date(Date.now() + clock.offsetMs),
  };
  const { app, services } = createApp(deps);
  return { app, services, deps, env, media, egress, storage, events, documents, llm, clock };
}

export const PASSWORD = 'correct-horse-battery-staple';

export async function createRecruiter(email = 'recruiter@example.test', name = 'Test Recruiter') {
  return testDb().user.create({ data: { email, name, passwordHash: await hashPassword(PASSWORD) } });
}

/** A supertest agent that keeps cookies, signed in as the given recruiter. */
export async function recruiterAgent(app: Express, email = 'recruiter@example.test') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/recruiter/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export const QUESTIONS = [
  { text: 'What is the difference between authentication and authorization?', category: 'TECHNICAL', difficulty: 'EASY', source: 'RECRUITER' },
  { text: 'How would you design a REST endpoint that is safe to retry?', category: 'TECHNICAL', difficulty: 'MEDIUM', source: 'RECRUITER' },
  { text: 'Tell me about a time you disagreed with a technical decision.', category: 'BEHAVIORAL', difficulty: 'EASY', source: 'RECRUITER' },
] as const;

export const JOB_DESCRIPTION = 'We are hiring a software engineer to build and own product features end to end with the team.';

/** Creates an interview, saves questions and marks it ready. Returns its id and invitation. */
export async function readyInterview(agent: request.Agent, config: Record<string, unknown> = {}) {
  const created = await agent.post('/api/interviews').send({
    jobTitle: 'Software Engineer',
    jobDescription: JOB_DESCRIPTION,
    requiredSkills: ['TypeScript'],
    candidateName: 'Jamie Candidate',
    candidateEmail: 'jamie@example.test',
    config: { durationMinutes: 20, ...config },
  });
  if (created.status !== 201) throw new Error(`create failed: ${created.status} ${JSON.stringify(created.body)}`);
  const id = created.body.id as string;
  const saved = await agent.patch(`/api/interviews/${id}/questions`).send({ questions: QUESTIONS });
  if (saved.status !== 200) throw new Error(`questions failed: ${saved.status} ${JSON.stringify(saved.body)}`);
  const ready = await agent.post(`/api/interviews/${id}/ready`);
  if (ready.status !== 200) throw new Error(`ready failed: ${ready.status} ${JSON.stringify(ready.body)}`);
  return { id, invitation: ready.body.invitation as { code: string; accessCode: string; url: string } };
}

/** Signs in as the candidate; returns a cookie-keeping agent and the session id. */
export async function candidateAgent(app: Express, invitation: { code: string; accessCode: string }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/candidate/access').send({ invitationCode: invitation.code, accessCode: invitation.accessCode });
  if (res.status !== 200) throw new Error(`access failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, sessionId: res.body.sessionId as string };
}

export const consentBody = (recordingConsent: boolean) => ({
  recordingNoticeVersion: 'rec-notice-2026-10',
  proctoringNoticeVersion: 'proc-notice-2026-10',
  recordingConsent,
  proctoringConsent: true,
});

/** Takes the candidate through consent + start; returns the first question response. */
export async function startInterview(agent: request.Agent, sessionId: string, recordingConsent = false) {
  const consent = await agent.post(`/api/candidate/sessions/${sessionId}/consent`).send(consentBody(recordingConsent));
  if (consent.status !== 200) throw new Error(`consent failed: ${consent.status} ${JSON.stringify(consent.body)}`);
  const start = await agent.post(`/api/candidate/sessions/${sessionId}/start`);
  if (start.status !== 200) throw new Error(`start failed: ${start.status} ${JSON.stringify(start.body)}`);
  return start.body;
}
