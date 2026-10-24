import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import type { RealtimeEventName } from '@contracts';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRealtimeServer, REALTIME_PATH } from '../../src/realtime/socketServer.js';
import { VALID_SIGNATURE } from './fakes.js';
import {
  buildTestApp,
  candidateAgent,
  createRecruiter,
  PASSWORD,
  readyInterview,
  recruiterAgent,
  resetDb,
  startInterview,
  type TestApp,
  type TestAppOptions,
} from './helpers.js';

describe('events published by the interview flow (PRD §11.2)', () => {
  beforeEach(resetDb);

  it('publishes status, question and answer events in order, once per real change', async () => {
    const t = buildTestApp();
    await createRecruiter();
    const recruiter = await recruiterAgent(t.app);
    const { id, invitation } = await readyInterview(recruiter);
    const { agent, sessionId } = await candidateAgent(t.app, invitation);
    const first = await startInterview(agent, sessionId);
    const s = `/api/candidate/sessions/${sessionId}`;
    const answer = { questionId: first.question.id, transcript: 'An answer.', durationSeconds: 5, inputMode: 'TEXT', idempotencyKey: 'rt-key-1' };
    const second = await agent.post(`${s}/answers`).send(answer);
    await agent.post(`${s}/answers`).send(answer); // retry: no new events
    await agent.post(`${s}/skip`).send({ questionId: second.body.question.id, idempotencyKey: 'rt-key-2' });
    await agent.post(`${s}/complete`);
    await agent.post(`${s}/complete`); // repeat: no new events

    expect(t.events.published.map((e) => e.event)).toEqual([
      'interview.status_changed', // READY
      'interview.status_changed', // ONBOARDING
      'interview.status_changed', // IN_PROGRESS
      'interview.question_changed', // 1
      'answer.saved', // 1 ANSWERED
      'interview.question_changed', // 2
      'answer.saved', // 2 SKIPPED
      'interview.question_changed', // 3
      'interview.status_changed', // COMPLETED
    ]);
    expect(t.events.of('interview.status_changed').map((e) => e.status)).toEqual(['READY', 'ONBOARDING', 'IN_PROGRESS', 'COMPLETED']);
    expect(t.events.of('interview.question_changed').map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(t.events.of('answer.saved').map((e) => e.status)).toEqual(['ANSWERED', 'SKIPPED']);
    for (const { payload } of t.events.published) {
      expect(payload.interviewId).toBe(id);
      expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
    }
  });

  it('publishes observation, phone and recording events without URLs or secrets', async () => {
    const t = buildTestApp({ recordingEnabled: true });
    await createRecruiter();
    const recruiter = await recruiterAgent(t.app);
    const { id, invitation } = await readyInterview(recruiter, { recordingEnabled: true });
    const { agent, sessionId } = await candidateAgent(t.app, invitation);
    const view = await agent.get(`/api/candidate/sessions/${sessionId}`);
    const token = new URL(view.body.pairing.url).searchParams.get('token')!;
    await request(t.app).post(`/api/interviews/${id}/media-token`).send({ device: 'secondary', pairingToken: token });
    await startInterview(agent, sessionId, true);
    await agent.post(`/api/interviews/${id}/events`).send({ type: 'TAB_HIDDEN', durationSeconds: 4 });

    const { egressId, objectKey } = t.egress.started[0]!;
    const hook = (body: Record<string, unknown>) =>
      request(t.app)
        .post('/api/webhooks/livekit/egress')
        .set('Authorization', VALID_SIGNATURE)
        .set('Content-Type', 'application/webhook+json')
        .send(JSON.stringify({ createdAt: new Date().toISOString(), ...body }));
    await hook({ id: 'EV_rt1', event: 'egress_started', egress: { egressId, roomName: 'x', state: 'ACTIVE', error: null, file: null } });
    await hook({ id: 'EV_rt2', event: 'participant_left', participant: { identity: `candidate-secondary:${id}` } });
    await agent.post(`/api/candidate/sessions/${sessionId}/complete`);
    t.storage.objects.set(objectKey, 100);
    await hook({ id: 'EV_rt3', event: 'egress_ended', egress: { egressId, roomName: 'x', state: 'COMPLETE', error: null, file: { filename: objectKey, sizeBytes: 100, durationSeconds: 3 } } });

    expect(t.events.of('media.secondary_connected')).toEqual([expect.objectContaining({ interviewId: id, status: 'PAIRED' })]);
    expect(t.events.of('media.secondary_disconnected')).toEqual([expect.objectContaining({ interviewId: id, status: 'DISCONNECTED' })]);
    expect(t.events.of('proctoring.event_created').map((e) => [e.type, e.sourceCamera])).toEqual([
      ['TAB_HIDDEN', 'PRIMARY'],
      ['SECONDARY_DISCONNECTED', 'SECONDARY'],
    ]);
    expect(t.events.of('recording.status_changed').map((e) => e.status)).toEqual(['PENDING', 'RECORDING', 'FINALIZING', 'READY']);
    const raw = JSON.stringify(t.events.published);
    expect(raw).not.toContain(objectKey);
    expect(raw).not.toContain(token);
  });

  it('includes the safe failure code when a recording fails', async () => {
    const t = buildTestApp({ recordingEnabled: true });
    await createRecruiter();
    const recruiter = await recruiterAgent(t.app);
    const { invitation } = await readyInterview(recruiter, { recordingEnabled: true });
    const { agent, sessionId } = await candidateAgent(t.app, invitation);
    t.egress.failStart = true;
    await startInterview(agent, sessionId, true);
    expect(t.events.of('recording.status_changed').map((e) => [e.status, e.failureCode])).toEqual([
      ['PENDING', null],
      ['FAILED', 'EGRESS_START_FAILED'],
    ]);
  });
});

/** Real Socket.IO server + clients: who receives what (PRD §11.2 authorization rules). */
describe('Socket.IO delivery and authorization', () => {
  let t: TestApp;
  let server: HttpServer;
  let ioServer: ReturnType<typeof createRealtimeServer>;
  let base: string;
  const sockets: Socket[] = [];

  async function startServer(opts: TestAppOptions = {}) {
    t = buildTestApp(opts);
    server = t.app.listen(0);
    ioServer = createRealtimeServer(server, t.deps, t.services, { revalidateMs: 150 });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async function loginCookie(email: string) {
    const res = await request(t.app).post('/api/auth/recruiter/login').send({ email, password: PASSWORD });
    return String(res.headers['set-cookie']).split(';')[0]!;
  }

  /** Connects and records every event the socket receives. */
  function open(role: string, cookie?: string) {
    const socket = connect(base, {
      path: REALTIME_PATH,
      transports: ['websocket'],
      auth: { role },
      extraHeaders: cookie ? { cookie } : {},
      reconnection: false,
    });
    const received: Array<{ event: string; payload: { interviewId: string; status?: string } }> = [];
    socket.onAny((event, payload) => received.push({ event, payload }));
    sockets.push(socket);
    const ready = new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (err) => reject(err));
    });
    return { socket, received, ready };
  }

  async function settle() {
    await t.events.flush();
    await new Promise((r) => setTimeout(r, 100));
  }

  function waitFor(socket: Socket, event: 'disconnect' | RealtimeEventName, timeoutMs = 3000) {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
      socket.once(event, (payload: unknown) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  beforeEach(resetDb);
  afterEach(async () => {
    for (const s of sockets.splice(0)) s.close();
    await new Promise<void>((resolve) => ioServer?.close(() => resolve()));
  });

  it('rejects sockets without a valid session', async () => {
    await startServer();
    await expect(open('recruiter').ready).rejects.toThrow('UNAUTHENTICATED');
    await expect(open('candidate', 'hb_candidate=forged').ready).rejects.toThrow('UNAUTHENTICATED');
    await expect(open('admin', 'hb_session=forged').ready).rejects.toThrow('UNAUTHENTICATED');
  });

  it('sends each recruiter only their own interviews, and candidates only safe events for theirs', async () => {
    await startServer();
    await createRecruiter('a@example.test', 'Alice');
    await createRecruiter('b@example.test', 'Bob');
    const alice = open('recruiter', await loginCookie('a@example.test'));
    const bob = open('recruiter', await loginCookie('b@example.test'));
    await Promise.all([alice.ready, bob.ready]);

    const aliceAgent = await recruiterAgent(t.app, 'a@example.test');
    const { id, invitation } = await readyInterview(aliceAgent);
    const access = await request(t.app).post('/api/candidate/access').send({ invitationCode: invitation.code, accessCode: invitation.accessCode });
    const candidateCookie = String(access.headers['set-cookie']).split(';')[0]!;
    const candidate = open('candidate', candidateCookie);
    await candidate.ready;

    const agent = request.agent(t.app);
    agent.jar.setCookie(`${candidateCookie}; Path=/api`, '127.0.0.1');
    await startInterview(agent, access.body.sessionId);
    await settle();

    expect(alice.received.filter((r) => r.event === 'interview.status_changed').map((r) => r.payload.status)).toEqual(['READY', 'ONBOARDING', 'IN_PROGRESS']);
    expect(alice.received.map((r) => r.event)).toContain('interview.question_changed');
    expect(bob.received).toEqual([]);
    // The candidate connected after ONBOARDING and only receives candidate-safe events.
    expect(candidate.received).toEqual([{ event: 'interview.status_changed', payload: expect.objectContaining({ interviewId: id, status: 'IN_PROGRESS' }) }]);
  });

  it('disconnects a socket once its session ends', async () => {
    await startServer();
    await createRecruiter();
    const cookie = await loginCookie('recruiter@example.test');
    const recruiter = open('recruiter', cookie);
    await recruiter.ready;
    const gone = waitFor(recruiter.socket, 'disconnect');
    await request(t.app).post('/api/auth/recruiter/logout').set('Cookie', cookie);
    await expect(gone).resolves.toBe('io server disconnect');
  });

  it('tells the candidate when the recruiter cancels, then drops the revoked session', async () => {
    await startServer();
    await createRecruiter();
    const recruiter = await recruiterAgent(t.app);
    const { id, invitation } = await readyInterview(recruiter);
    const access = await request(t.app).post('/api/candidate/access').send({ invitationCode: invitation.code, accessCode: invitation.accessCode });
    const candidate = open('candidate', String(access.headers['set-cookie']).split(';')[0]!);
    await candidate.ready;

    const cancelled = waitFor(candidate.socket, 'interview.status_changed');
    const gone = waitFor(candidate.socket, 'disconnect');
    await recruiter.post(`/api/interviews/${id}/cancel`);
    await expect(cancelled).resolves.toMatchObject({ interviewId: id, status: 'CANCELLED' });
    await expect(gone).resolves.toBe('io server disconnect');
  });
});
