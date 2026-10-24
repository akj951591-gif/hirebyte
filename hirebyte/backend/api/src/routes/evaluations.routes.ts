import { Router } from 'express';
import type { RouteContext } from './index.js';
import { evaluationController } from '../controllers/evaluation.controller.js';

export function evaluationRoutes({ services, requireRecruiter }: RouteContext): Router {
  const c = evaluationController(services);
  const r = Router();
  r.patch('/evaluations/:id/review', requireRecruiter, c.review);
  return r;
}
