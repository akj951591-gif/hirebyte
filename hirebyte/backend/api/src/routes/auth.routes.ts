import { Router } from 'express';
import type { RouteContext } from './index.js';
import { authController } from '../controllers/auth.controller.js';
import { loginRateLimit } from '../middleware/rateLimit.js';

export function authRoutes({ services, env, requireRecruiter }: RouteContext): Router {
  const c = authController(services, env);
  const r = Router();
  r.post('/auth/recruiter/login', loginRateLimit(env), c.login);
  r.post('/auth/recruiter/logout', c.logout);
  r.get('/auth/me', requireRecruiter, c.me);
  return r;
}
