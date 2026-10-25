import type * as Api from '@contracts';
import type { AppDeps } from '../../context.js';
import type { Recording, RecordingStatus } from '../../generated/prisma/client.js';
import { Errors } from '../../lib/errors.js';
import { logger, safeError } from '../../lib/logger.js';
import type { EgressSnapshot } from '../../providers/media/egress.provider.js';
import type { MediaWebhookEvent } from '../../providers/media/livekit.provider.js';
import { recordingObjectKey } from '../../providers/object-storage/s3Storage.provider.js';
import { recordAudit } from '../../repositories/auditEvent.repository.js';
import { findActiveRecording, transitionRecording } from '../../repositories/recording.repository.js';
import type { AuthUser } from '../auth/auth.service.js';
import { parseConfig, toRecording } from '../interviews/dto.js';
import { findInterviewForUser } from '../interviews/interview.service.js';
import { roomNameFor } from '../media/media.service.js';
import { ACTIVE_RECORDING_STATUSES, canTransitionRecording, statusForEgress } from './recordingStateMachine.js';

/** Reconcile with LiveKit when a non-final recording has not changed for this long (webhooks may not reach a dev machine). */
const RECONCILE_AFTER_MS = 15_000;

/**
 * Recording lifecycle (PRD §9.2): LiveKit Egress writes one composite MP4 into the private R2 bucket.
 * Status only advances on provider confirmation, and READY requires the object to exist in R2.
 */
export function createRecordingService(deps: AppDeps) {
  const { db, env, egress, storage, media, now, events } = deps;

  /** `recording.status_changed` after a committed change; carries only a safe failure code. */
  const announce = (rec: { id: string; interviewId: string }, status: RecordingStatus, failureCode: string | null = null) =>
    events.publish('recording.status_changed', { interviewId: rec.interviewId, recordingId: rec.id, status, failureCode, timestamp: now().toISOString() });

  async function moveToFinalizing(rec: Recording) {
    if (canTransitionRecording(rec.status, 'FINALIZING') && (await transitionRecording(db, rec.id, rec.status, { status: 'FINALIZING' }))) {
      announce(rec, 'FINALIZING');
    }
  }

  async function markFailed(rec: Recording, failureCode: string) {
    if (!canTransitionRecording(rec.status, 'FAILED')) return;
    if (await transitionRecording(db, rec.id, rec.status, { status: 'FAILED', failureCode, completedAt: now() })) {
      announce(rec, 'FAILED', failureCode);
      await recordAudit(db, { actorRole: 'SYSTEM', action: 'recording.failed', resourceType: 'recording', resourceId: rec.id, metadata: { failureCode } });
    }
  }

  /** Applies a provider snapshot (from a webhook or from polling) to our record, idempotently. */
  async function applyEgressSnapshot(rec: Recording, snap: Pick<EgressSnapshot, 'state' | 'error' | 'file'>): Promise<void> {
    const target = statusForEgress(snap.state);
    if (!target) return;

    if (target === 'FAILED') {
      await markFailed(rec, `EGRESS_${snap.state}`);
      return;
    }

    let current = rec;
    if (target === 'RECORDING' || target === 'FINALIZING') {
      if (canTransitionRecording(current.status, target)) {
        const moved = await transitionRecording(db, current.id, current.status, {
          status: target,
          ...(target === 'RECORDING' && !current.startedAt ? { startedAt: now() } : {}),
        });
        if (moved) announce(current, target);
        current = { ...current, status: target };
      }
    }

    // Egress finished: confirm the object really exists in R2 before calling it READY.
    if (snap.state === 'COMPLETE' && current.status === 'FINALIZING') {
      if (!storage || !current.objectKey) return;
      try {
        const head = await storage.head(current.objectKey);
        if (!head.exists) {
          await markFailed(current, 'OBJECT_MISSING');
          return;
        }
        const ready = await transitionRecording(db, current.id, 'FINALIZING', {
          status: 'READY',
          mimeType: head.contentType ?? 'video/mp4',
          sizeBytes: BigInt(head.sizeBytes ?? snap.file?.sizeBytes ?? 0),
          durationSeconds: snap.file?.durationSeconds ?? null,
          completedAt: now(),
        });
        if (ready) {
          announce(current, 'READY');
          await recordAudit(db, { actorRole: 'SYSTEM', action: 'recording.ready', resourceType: 'recording', resourceId: current.id });
        }
      } catch (err) {
        // Leave it FINALIZING; the next webhook or reconcile retries the storage check.
        logger.warn('recording storage check failed', { recordingId: current.id, ...safeError(err) });
      }
    }
  }

  async function reconcile(rec: Recording): Promise<Recording> {
    if (!egress || !rec.egressId || !ACTIVE_RECORDING_STATUSES.includes(rec.status)) return rec;
    if (now().getTime() - rec.updatedAt.getTime() < RECONCILE_AFTER_MS) return rec;
    try {
      const snap = await egress.get(rec.egressId);
      if (snap) await applyEgressSnapshot(rec, snap);
      else await db.recording.update({ where: { id: rec.id }, data: { updatedAt: now() } });
    } catch (err) {
      logger.warn('egress reconcile failed', { recordingId: rec.id, ...safeError(err) });
    }
    return db.recording.findUniqueOrThrow({ where: { id: rec.id } });
  }

  const service = {
    /** Called when the interview starts. Never throws: a recording failure must not block the interview. */
    async startForInterview(interviewId: string, consentRecordId: string): Promise<void> {
      if (!env.RECORDING_ENABLED || !egress || !media) return;
      const existing = await findActiveRecording(db, interviewId, [...ACTIVE_RECORDING_STATUSES, 'READY']);
      if (existing) return;

      const rec = await db.recording.create({
        data: {
          interviewId,
          status: 'PENDING',
          consentRecordId,
          retentionExpiresAt: env.RECORDING_RETENTION_DAYS ? new Date(now().getTime() + env.RECORDING_RETENTION_DAYS * 86_400_000) : null,
        },
      });
      const objectKey = recordingObjectKey(interviewId, rec.id);
      await db.recording.update({ where: { id: rec.id }, data: { objectKey } });
      announce(rec, 'PENDING');
      try {
        await media.ensureRoom(roomNameFor(interviewId));
        const snap = await egress.startRoomComposite(roomNameFor(interviewId), objectKey);
        await db.recording.update({ where: { id: rec.id }, data: { egressId: snap.egressId } });
        await recordAudit(db, { actorRole: 'SYSTEM', action: 'recording.requested', resourceType: 'recording', resourceId: rec.id });
        await applyEgressSnapshot({ ...rec, objectKey, egressId: snap.egressId }, snap);
      } catch (err) {
        logger.error('egress start failed', { interviewId, recordingId: rec.id, ...safeError(err) });
        await markFailed({ ...rec, objectKey }, 'EGRESS_START_FAILED');
      }
    },

    /** Called when the interview completes: ask LiveKit to stop and upload. */
    async finalizeForInterview(interviewId: string): Promise<void> {
      const rec = await findActiveRecording(db, interviewId, ['PENDING', 'RECORDING']);
      if (!rec) return;
      if (!rec.egressId || !egress) {
        await markFailed(rec, 'EGRESS_NOT_STARTED');
        return;
      }
      try {
        const snap = await egress.stop(rec.egressId);
        await moveToFinalizing(rec);
        await applyEgressSnapshot({ ...rec, status: 'FINALIZING' }, snap);
      } catch (err) {
        // Often "egress already ended"; the webhook or reconcile settles the final state.
        logger.warn('egress stop failed', { recordingId: rec.id, ...safeError(err) });
        await moveToFinalizing(rec);
      }
    },

    /**
     * Asks LiveKit about recordings still in progress, so their status keeps up with the provider
     * even when webhooks cannot reach this server. Run periodically; returns how many were checked.
     */
    async reconcileActive(): Promise<number> {
      if (!egress) return 0;
      const active = await db.recording.findMany({ where: { status: { in: [...ACTIVE_RECORDING_STATUSES] }, egressId: { not: null } }, take: 50 });
      for (const rec of active) await reconcile(rec);
      return active.length;
    },

    /**
     * Retention (PRD §9.2): deletes the R2 object of every recording past `retentionExpiresAt`, then
     * marks it DELETED. A failed delete is audited, left as it was and retried on the next run.
     */
    async deleteExpired(): Promise<{ deleted: number; failed: number }> {
      const due = await db.recording.findMany({ where: { status: { in: ['READY', 'FAILED'] }, retentionExpiresAt: { lte: now() } }, take: 50 });
      let deleted = 0;
      let failed = 0;
      for (const rec of due) {
        if (rec.objectKey) {
          try {
            if (!storage) throw new Error('storage not configured');
            await storage.delete(rec.objectKey);
          } catch (err) {
            failed += 1;
            logger.warn('retention delete failed', { recordingId: rec.id, ...safeError(err) });
            await recordAudit(db, { actorRole: 'SYSTEM', action: 'recording.retention_delete_failed', resourceType: 'recording', resourceId: rec.id });
            continue;
          }
        }
        if (await transitionRecording(db, rec.id, rec.status, { status: 'DELETED', deletedAt: now() })) {
          deleted += 1;
          announce(rec, 'DELETED');
          await recordAudit(db, { actorRole: 'SYSTEM', action: 'recording.retention_deleted', resourceType: 'recording', resourceId: rec.id });
        }
      }
      return { deleted, failed };
    },

    /** LiveKit egress_* webhooks (already signature-verified and de-duplicated by the caller). */
    async handleEgressEvent(evt: MediaWebhookEvent): Promise<void> {
      if (!evt.egress) return;
      const rec = await db.recording.findUnique({ where: { egressId: evt.egress.egressId } });
      if (!rec) {
        logger.info('webhook for unknown egress ignored', { event: evt.event });
        return;
      }
      await applyEgressSnapshot(rec, evt.egress);
    },

    async list(user: AuthUser, interviewId: string): Promise<Api.ListRecordingsResponse> {
      await findInterviewForUser(db, user, interviewId);
      const rows = await db.recording.findMany({ where: { interviewId }, orderBy: { createdAt: 'desc' } });
      const settled = await Promise.all(rows.map(reconcile));
      return { items: settled.map(toRecording) };
    },

    /** Recruiter retry for a failed or missing recording while the interview is still running. */
    async retryStart(user: AuthUser, interviewId: string): Promise<Api.ListRecordingsResponse> {
      const interview = await findInterviewForUser(db, user, interviewId);
      if (!env.RECORDING_ENABLED || !egress) throw Errors.notConfigured('RECORDING_UNAVAILABLE', 'Recording is not enabled on this server.');
      if (interview.status !== 'IN_PROGRESS') throw Errors.conflict('Recording can only be started while the interview is in progress.');
      if (!parseConfig(interview.config).recordingEnabled) throw Errors.conflict('Recording was not requested for this interview.');
      const consent = await db.consentRecord.findFirst({ where: { interviewId }, orderBy: { consentedAt: 'desc' } });
      if (!consent?.recordingConsent) throw Errors.conflict('The candidate did not consent to recording.', 'CONSENT_REQUIRED');
      await service.startForInterview(interviewId, consent.id);
      await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'recording.retry', resourceType: 'interview', resourceId: interviewId });
      return service.list(user, interviewId);
    },
  };
  return service;
}

export type RecordingService = ReturnType<typeof createRecordingService>;
