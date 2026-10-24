import { Router, type RequestHandler } from 'express';
import type { Env } from '../config/env.js';
import type { AppDeps } from '../context.js';
import { requireCandidateSession } from '../middleware/requireCandidateSession.js';
import { requireRecruiter } from '../middleware/requireRecruiter.js';
import type { Db } from '../repositories/prisma.js';
import type { Services } from '../services/index.js';
import { authRoutes } from './auth.routes.js';
import { candidateRoutes } from './candidate.routes.js';
import { evaluationRoutes } from './evaluations.routes.js';
import { interviewRoutes } from './interviews.routes.js';
import { proctoringRoutes } from './proctoring.routes.js';
import { recordingRoutes } from './recordings.routes.js';
import { webhookRoutes } from './webhooks.routes.js';

export interface RouteContext {
  deps: AppDeps;
  services: Services;
  env: Env;
  db: Db;
  requireRecruiter: RequestHandler;
  requireCandidate: RequestHandler;
}

export function routeContext(deps: AppDeps, services: Services): RouteContext {
  return {
    deps,
    services,
    env: deps.env,
    db: deps.db,
    requireRecruiter: requireRecruiter(services.auth),
    requireCandidate: requireCandidateSession(services.candidates),
  };
}

/** JSON API routes (PRD §11 baseline). Webhooks are mounted separately with a raw body parser. */
export function apiRoutes(ctx: RouteContext): Router {
  const r = Router();
  r.use(authRoutes(ctx));
  r.use(candidateRoutes(ctx));
  r.use(recordingRoutes(ctx));
  r.use(proctoringRoutes(ctx));
  r.use(interviewRoutes(ctx));
  r.use(evaluationRoutes(ctx));
  return r;
}

export { webhookRoutes };
