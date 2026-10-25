import { Router } from 'express';
import type { RouteContext } from './index.js';
import { proctoringController } from '../controllers/proctoring.controller.js';

export function proctoringRoutes({ services, requireRecruiter, requireCandidate }: RouteContext): Router {
  const c = proctoringController(services);
  const r = Router();
  r.post('/interviews/:id/events', requireCandidate, c.create);
  r.post('/interviews/:id/phone-events', c.createFromPhone);
  r.patch('/proctoring-events/:id/review', requireRecruiter, c.review);
  return r;
}
