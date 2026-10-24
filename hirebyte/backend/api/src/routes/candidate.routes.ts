import { Router } from 'express';
import type { RouteContext } from './index.js';
import { candidateController } from '../controllers/candidate.controller.js';
import { candidateAccessRateLimit } from '../middleware/rateLimit.js';

/** Candidate-safe routes only (PRD §2.1). Every session route checks the cookie owns :sessionId. */
export function candidateRoutes({ services, env, requireCandidate }: RouteContext): Router {
  const c = candidateController(services, env);
  const r = Router();
  r.post('/candidate/access', candidateAccessRateLimit(env), c.access);
  r.post('/candidate/logout', c.logout);
  const s = '/candidate/sessions/:sessionId';
  r.get(s, requireCandidate, c.session);
  r.post(`${s}/consent`, requireCandidate, c.consent);
  r.post(`${s}/start`, requireCandidate, c.start);
  r.get(`${s}/current-question`, requireCandidate, c.current);
  r.post(`${s}/answers`, requireCandidate, c.answer);
  r.post(`${s}/skip`, requireCandidate, c.skip);
  r.post(`${s}/complete`, requireCandidate, c.complete);
  return r;
}
