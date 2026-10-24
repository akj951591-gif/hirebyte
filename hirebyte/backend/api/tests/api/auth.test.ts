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
