import type { RequestHandler } from 'express';
import { Errors } from '../lib/errors.js';
import { logger, safeError } from '../lib/logger.js';
import { isUniqueViolation, type Db } from '../repositories/prisma.js';
import type { Services } from '../services/index.js';

/**
 * LiveKit webhook (signature already verified). Each delivery id is recorded first so repeats are
 * no-ops (PRD §9.4); if processing fails the record is removed so LiveKit's retry is processed.
 */
export function webhooksController(s: Services, db: Db) {
  const livekit: RequestHandler = async (req, res) => {
    const evt = req.webhookEvent;
    if (!evt) throw Errors.unauthenticated();
    if (!evt.id) throw Errors.validation('Webhook event has no id.');

    try {
      await db.webhookDelivery.create({ data: { id: evt.id, provider: 'livekit', event: evt.event } });
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.json({ status: 'duplicate' });
        return;
      }
      throw err;
    }

    try {
      if (evt.event.startsWith('egress_')) await s.recordings.handleEgressEvent(evt);
      else if (evt.event.startsWith('participant_')) await s.media.handleParticipantEvent(evt);
    } catch (err) {
      logger.error('webhook processing failed', { event: evt.event, ...safeError(err) });
      await db.webhookDelivery.delete({ where: { id: evt.id } }).catch(() => undefined);
      throw err;
    }
    res.json({ status: 'ok' });
  };

  return { livekit };
}
