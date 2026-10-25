import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, createRecruiter, PASSWORD, recruiterAgent, resetDb, testDb } from './helpers.js';

describe('recruiter authentication (PRD §2.2)', () => {
  beforeEach(resetDb);

  it('rejects protected routes without a session', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const { app } = buildTestApp();
    await createRecruiter();
    const wrong = await request(app).post('/api/auth/recruiter/login').send({ email: 'recruiter@example.test', password: 'nope' });
    const unknown = await request(app).post('/api/auth/recruiter/login').send({ email: 'ghost@example.test', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error).toMatchObject({ code: wrong.body.error.code, message: wrong.body.error.message });
  });

  it('signs in with an HttpOnly cookie, returns only safe identity, and signs out', async () => {
    const { app } = buildTestApp();
    await createRecruiter();
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/recruiter/login').send({ email: 'RECRUITER@example.test', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user).toEqual({ id: expect.any(String), email: 'recruiter@example.test', name: 'Test Recruiter', role: 'RECRUITER' });
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toMatch(/hb_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    expect((await agent.get('/api/auth/me')).body.user.email).toBe('recruiter@example.test');
    expect((await agent.post('/api/auth/recruiter/logout')).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);

    const session = await testDb().userSession.findFirstOrThrow();
    expect(session.revokedAt).not.toBeNull();
    expect(session.tokenHash).not.toContain(cookie.split('hb_session=')[1]?.split(';')[0] ?? '');
  });

  it('locks the account after 5 failed attempts, even for the right password', async () => {
    const { app } = buildTestApp();
    await createRecruiter();
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/api/auth/recruiter/login').send({ email: 'recruiter@example.test', password: 'wrong' });
    }
    const res = await request(app).post('/api/auth/recruiter/login').send({ email: 'recruiter@example.test', password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('validates the login body', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/auth/recruiter/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields).toHaveProperty('email');
  });

  it('reports configuration state on the public health endpoint', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok', media: 'not_configured', storage: 'not_configured', recording: 'disabled' });
  });

  it('keeps a recruiter session usable after a fresh login', async () => {
    const { app } = buildTestApp();
    await createRecruiter();
    const agent = await recruiterAgent(app);
    expect((await agent.get('/api/interviews')).status).toBe(200);
  });
});

describe('recruiter self-service sign-up', () => {
  beforeEach(resetDb);
  const NEW_PASSWORD = 'a-long-unique-passphrase-2026';
  const body = { name: 'Priya Sharma', email: 'Priya.Sharma@Example.test', password: NEW_PASSWORD };

  it('creates a recruiter, signs them in with an HttpOnly cookie, and stores only a password hash', async () => {
    const { app } = buildTestApp();
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/recruiter/register').send(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ user: { id: expect.any(String), email: 'priya.sharma@example.test', name: 'Priya Sharma', role: 'RECRUITER' } });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/hb_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    expect((await agent.get('/api/auth/me')).body.user.email).toBe('priya.sharma@example.test');
    const stored = await testDb().user.findUniqueOrThrow({ where: { email: 'priya.sharma@example.test' } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(res.body)).not.toContain(NEW_PASSWORD);
    expect(JSON.stringify(res.body)).not.toContain(stored.passwordHash);
  });

  it('lets the new recruiter sign in later, and they start with no interviews', async () => {
    const { app } = buildTestApp();
    await request(app).post('/api/auth/recruiter/register').send(body);
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/recruiter/login').send({ email: 'priya.sharma@example.test', password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    const list = await agent.get('/api/interviews');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toMatch(/"id"/);
  });

  it('refuses an email that is already registered, whatever its case, and leaves the old account alone', async () => {
    const { app } = buildTestApp();
    await createRecruiter('taken@example.test', 'First Owner');
    const res = await request(app).post('/api/auth/recruiter/register').send({ ...body, email: 'TAKEN@example.test' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    const owner = await testDb().user.findUniqueOrThrow({ where: { email: 'taken@example.test' } });
    expect(owner.name).toBe('First Owner');
    expect(await testDb().user.count()).toBe(1);
    expect((await request(app).post('/api/auth/recruiter/login').send({ email: 'taken@example.test', password: NEW_PASSWORD })).status).toBe(401);
  });

  it('only one of two simultaneous sign-ups for the same email wins', async () => {
    const { app } = buildTestApp();
    const results = await Promise.all([request(app).post('/api/auth/recruiter/register').send(body), request(app).post('/api/auth/recruiter/register').send(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await testDb().user.count()).toBe(1);
  });

  it('validates the name, email and password', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/auth/recruiter/register').send({ name: 'P', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.details.fields).sort()).toEqual(['email', 'name', 'password']);
    expect(await testDb().user.count()).toBe(0);
  });

  it('turns away long passwords that are still obvious', async () => {
    const { app } = buildTestApp();
    for (const password of ['aaaaaaaaaaaa', '123456789012', 'password1234', 'hirebyte2026', 'priya.sharma-2026']) {
      const res = await request(app).post('/api/auth/recruiter/register').send({ ...body, password });
      expect(res.status, password).toBe(400);
      expect(res.body.error.details.fields).toHaveProperty('password');
    }
    expect(await testDb().user.count()).toBe(0);
  });

  it('can be switched off', async () => {
    const { app } = buildTestApp({ env: { RECRUITER_SIGNUP_ENABLED: 'false' } });
    const res = await request(app).post('/api/auth/recruiter/register').send(body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SIGNUP_DISABLED');
    expect(await testDb().user.count()).toBe(0);
  });
});
