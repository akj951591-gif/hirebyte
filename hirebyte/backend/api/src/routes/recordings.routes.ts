import { Router } from 'express';
import type { RouteContext } from './index.js';
import { recordingsController } from '../controllers/recordings.controller.js';

export function recordingRoutes({ services, requireRecruiter }: RouteContext): Router {
  const c = recordingsController(services);
  const r = Router();
  // Media tokens authenticate inside the handler: recruiter, candidate or one-time pairing token.
  r.post('/interviews/:id/media-token', c.mediaToken);
  r.get('/interviews/:id/recordings', requireRecruiter, c.list);
  r.post('/interviews/:id/recordings/start', requireRecruiter, c.start);
  r.post('/recordings/:recordingId/playback-url', requireRecruiter, c.playbackUrl);
  r.delete('/recordings/:recordingId', requireRecruiter, c.remove);
  return r;
}
