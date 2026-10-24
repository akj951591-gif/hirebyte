import type * as Api from '@contracts';
import type { AppDeps } from '../../context.js';
import { AppError, Errors } from '../../lib/errors.js';
import { logger, safeError } from '../../lib/logger.js';
import { recordAudit } from '../../repositories/auditEvent.repository.js';
import { findRecordingWithInterview } from '../../repositories/recording.repository.js';
import type { AuthUser } from '../auth/auth.service.js';
import { toRecording } from '../interviews/dto.js';

/** Signed playback and deletion (PRD §9.2 steps 12-13). Authorization happens on every call. */
export function createPlaybackService({ db, env, storage, now, events }: AppDeps) {
  async function authorizedRecording(user: AuthUser, recordingId: string) {
    const rec = await findRecordingWithInterview(db, recordingId);
    // Same 404 for "missing" and "not yours", so recording ids cannot be probed.
    if (!rec || (user.role !== 'ADMIN' && rec.interview.recruiterId !== user.id)) throw Errors.notFound('Recording');
    return rec;
  }

  return {
    async playbackUrl(user: AuthUser, recordingId: string): Promise<Api.PlaybackUrlResponse> {
      const rec = await authorizedRecording(user, recordingId);
      if (rec.status === 'DELETED') throw new AppError(410, 'RECORDING_DELETED', 'This recording has been deleted.');
      if (rec.status !== 'READY' || !rec.objectKey) throw new AppError(409, 'RECORDING_NOT_READY', 'The recording is not ready yet.');
      if (!storage) throw Errors.notConfigured('RECORDING_UNAVAILABLE', 'Recording storage is not configured on this server.');

      let head;
      try {
        head = await storage.head(rec.objectKey);
      } catch (err) {
        logger.error('storage head failed', { recordingId, ...safeError(err) });
        throw Errors.notConfigured('RECORDING_UNAVAILABLE', 'Recording storage is unreachable right now. Please try again.');
      }
      if (!head.exists) throw new AppError(410, 'RECORDING_DELETED', 'The recording file is missing from storage.');

      const ttl = env.R2_SIGNED_URL_TTL_SECONDS;
      const url = await storage.signedGetUrl(rec.objectKey, ttl, { contentType: rec.mimeType ?? 'video/mp4' });
      // Audit the issuance, never the URL itself (PRD §10 AuditEvent).
      await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'recording.playback_url_issued', resourceType: 'recording', resourceId: rec.id, metadata: { ttlSeconds: ttl } });
      return { url, expiresAt: new Date(now().getTime() + ttl * 1000).toISOString() };
    },

    /** Deletes the R2 object first; metadata is marked DELETED only if that succeeded. */
    async remove(user: AuthUser, recordingId: string): Promise<Api.Recording> {
      const rec = await authorizedRecording(user, recordingId);
      if (rec.status === 'DELETED') return toRecording(rec);
      if (!['READY', 'FAILED'].includes(rec.status)) throw Errors.conflict('A recording that is still in progress cannot be deleted.');
      if (rec.objectKey) {
        if (!storage) throw Errors.notConfigured('RECORDING_UNAVAILABLE', 'Recording storage is not configured on this server.');
        try {
          await storage.delete(rec.objectKey);
        } catch (err) {
          logger.error('recording delete failed', { recordingId, ...safeError(err) });
          await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'recording.delete_failed', resourceType: 'recording', resourceId: rec.id });
          throw new AppError(502, 'RECORDING_DELETE_FAILED', 'The recording file could not be deleted. Nothing was changed; please try again.');
        }
      }
      const updated = await db.recording.update({ where: { id: rec.id }, data: { status: 'DELETED', deletedAt: now() } });
      events.publish('recording.status_changed', { interviewId: rec.interviewId, recordingId: rec.id, status: 'DELETED', failureCode: null, timestamp: now().toISOString() });
      await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'recording.deleted', resourceType: 'recording', resourceId: rec.id });
      return toRecording(updated);
    },
  };
}

export type PlaybackService = ReturnType<typeof createPlaybackService>;
