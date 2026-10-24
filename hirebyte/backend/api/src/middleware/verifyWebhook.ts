import type { RequestHandler } from 'express';
import { AppError, Errors } from '../lib/errors.js';
import { logger, safeError } from '../lib/logger.js';
import type { WebhookVerifier } from '../providers/media/livekit.provider.js';

/** Verifies LiveKit's signed webhook against the raw body (PRD §4.1: callbacks must be authenticated). */
export function verifyLiveKitWebhook(verifier: WebhookVerifier | null): RequestHandler {
  return async (req, _res, next) => {
    if (!verifier) return next(Errors.notConfigured('MEDIA_NOT_CONFIGURED', 'LiveKit is not configured on this server.'));
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    try {
      req.webhookEvent = await verifier.receive(raw, req.get('authorization') ?? undefined);
      next();
    } catch (err) {
      logger.warn('rejected webhook with invalid signature', { requestId: req.id, ...safeError(err) });
      next(new AppError(401, 'UNAUTHENTICATED', 'Invalid webhook signature.'));
    }
  };
}
