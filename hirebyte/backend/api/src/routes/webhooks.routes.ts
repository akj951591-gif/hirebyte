import express, { Router } from 'express';
import type { RouteContext } from './index.js';
import { webhooksController } from '../controllers/webhooks.controller.js';
import { verifyLiveKitWebhook } from '../middleware/verifyWebhook.js';

/** Mounted before the JSON parser: signature verification needs the exact raw body. */
export function webhookRoutes({ services, db, deps }: RouteContext): Router {
  const c = webhooksController(services, db);
  const r = Router();
  r.post('/webhooks/livekit/egress', express.raw({ type: () => true, limit: '1mb' }), verifyLiveKitWebhook(deps.webhooks), c.livekit);
  return r;
}
