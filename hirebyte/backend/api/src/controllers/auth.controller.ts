import type { RequestHandler } from 'express';
import type { Env } from '../config/env.js';
import { Errors } from '../lib/errors.js';
import { clearRecruiterCookie, setRecruiterCookie } from '../middleware/requireRecruiter.js';
import { recruiterLoginSchema } from '../schemas/auth.schema.js';
import { RECRUITER_COOKIE } from '../services/auth/auth.service.js';
import type { Services } from '../services/index.js';

export function authController(s: Services, env: Env) {
  const login: RequestHandler = async (req, res) => {
    const { email, password } = recruiterLoginSchema.parse(req.body);
    const { user, token, expiresAt } = await s.auth.login(email, password);
    setRecruiterCookie(res, env, token, expiresAt);
    res.json({ user });
  };

  const logout: RequestHandler = async (req, res) => {
    await s.auth.logout(req.cookies?.[RECRUITER_COOKIE]);
    clearRecruiterCookie(res, env);
    res.status(204).end();
  };

  const me: RequestHandler = async (req, res) => {
    if (!req.user) throw Errors.unauthenticated();
    res.json({ user: req.user });
  };

  return { login, logout, me };
}
