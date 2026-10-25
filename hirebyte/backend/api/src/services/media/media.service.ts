import type * as Api from '@contracts';
import type { AppDeps } from '../../context.js';
import type { InterviewStatus } from '../../generated/prisma/client.js';
import type { MediaWebhookEvent } from '../../providers/media/livekit.provider.js';
import { AppError, Errors } from '../../lib/errors.js';
import { recordAudit } from '../../repositories/auditEvent.repository.js';
import type { DbOrTx } from '../../repositories/prisma.js';
import type { AuthUser } from '../auth/auth.service.js';
import type { CandidateContext } from '../auth/candidateSession.service.js';
import { parseConfig } from '../interviews/dto.js';
import { findInterviewForUser } from '../interviews/interview.service.js';
import { isFinished, isLive } from '../interviews/stateMachine.js';

/** One LiveKit room per interview; the name is opaque (no candidate data). */
export const roomNameFor = (interviewId: string) => `hb-${interviewId}`;

/** Participant identities encode the device role so webhooks can update the right camera state. */
const IDENTITY = {
  primary: (interviewId: string) => `candidate-primary:${interviewId}`,
  secondary: (interviewId: string) => `candidate-secondary:${interviewId}`,
  recruiter: (userId: string) => `recruiter:${userId}`,
};

export async function ensureMediaSession(db: DbOrTx, interviewId: string) {
  return db.mediaSession.upsert({
    where: { interviewId },
    update: {},
    create: { interviewId, roomName: roomNameFor(interviewId) },
  });
}

export type MediaTokenResponse = Api.MediaTokenResponse;

export function createMediaService(deps: AppDeps) {
  const { db, env, crypto, media, now, events } = deps;

  const requireMedia = () => {
    if (!media) throw Errors.notConfigured('MEDIA_NOT_CONFIGURED', 'Live video is not configured on this server (LiveKit settings are missing).');
    return media;
  };

  async function issue(interviewId: string, identity: string, opts: { canPublish: boolean; canSubscribe: boolean; sources?: Array<'camera' | 'microphone'>; hidden?: boolean; name?: string }): Promise<MediaTokenResponse> {
    const provider = requireMedia();
    const room = roomNameFor(interviewId);
    await ensureMediaSession(db, interviewId);
    const token = await provider.createToken({ room, identity, ttlSeconds: env.MEDIA_TOKEN_TTL_SECONDS, ...opts });
    return { url: provider.url, token, room, identity, expiresAt: new Date(now().getTime() + env.MEDIA_TOKEN_TTL_SECONDS * 1000).toISOString() };
  }

  /** The phone currently paired with this interview (by its device token), while video is allowed. */
  async function verifyPhone(interviewId: string, deviceToken: string) {
    const session = await db.mediaSession.findUnique({ where: { phoneDeviceTokenHash: crypto.hash(deviceToken) }, include: { interview: { select: { status: true, config: true } } } });
    if (!session || session.interviewId !== interviewId) {
      throw new AppError(401, 'UNAUTHENTICATED', 'This phone is no longer paired. Scan the QR code on your laptop again.');
    }
    assertPhoneAllowed(session.interview);
    return session;
  }

  function assertPhoneAllowed(interview: { status: InterviewStatus; config: unknown }) {
    if (!isLive(interview.status)) throw Errors.conflict('The interview is not open for video.');
    if (parseConfig(interview.config).secondaryCamera === 'OFF') throw Errors.forbidden('A phone camera is not used for this interview.');
  }

  return {
    /** Recruiter live view: subscribe-only and hidden from the candidate (PRD §9.1). */
    async tokenForRecruiter(user: AuthUser, interviewId: string) {
      const interview = await findInterviewForUser(db, user, interviewId);
      if (!isLive(interview.status)) throw Errors.conflict('Live view is only available while the interview is running.');
      const res = await issue(interview.id, IDENTITY.recruiter(user.id), { canPublish: false, canSubscribe: true, hidden: true, name: user.name });
      await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'media.recruiter_token_issued', resourceType: 'interview', resourceId: interview.id });
      return res;
    },

    /**
     * Candidate laptop: publish camera + microphone, and subscribe so the candidate can see their own
     * phone camera. Nothing else in the room can be seen: the phone publishes camera video only and
     * the recruiter's view is hidden and publishes nothing.
     */
    async tokenForCandidate(candidate: CandidateContext, interviewId: string) {
      if (candidate.interviewId !== interviewId) throw Errors.forbidden();
      const interview = await db.interview.findUniqueOrThrow({ where: { id: interviewId }, select: { status: true } });
      if (!isLive(interview.status)) throw Errors.conflict('The interview is not open for video.');
      return issue(interviewId, IDENTITY.primary(interviewId), { canPublish: true, canSubscribe: true, sources: ['camera', 'microphone'] });
    },

    /**
     * Phone camera (PRD §9.1). First use exchanges the one-time pairing token from the QR link (the QR
     * alone is not security) and returns a device token. After a reload the phone sends that device
     * token instead. Each new pairing replaces it, so only the most recently paired phone can rejoin.
     */
    async tokenForPhone(interviewId: string, creds: { pairingToken?: string; deviceToken?: string }): Promise<MediaTokenResponse> {
      requireMedia();
      const phoneGrant = { canPublish: true, canSubscribe: false, sources: ['camera' as const] };

      if (creds.pairingToken) {
        const session = await db.mediaSession.findUnique({ where: { pairingTokenHash: crypto.hash(creds.pairingToken) }, include: { interview: { select: { status: true, config: true } } } });
        if (!session || session.interviewId !== interviewId) throw new AppError(401, 'UNAUTHENTICATED', 'This pairing link is not valid.');
        if (!session.pairingExpiresAt || session.pairingExpiresAt <= now()) throw new AppError(410, 'SESSION_EXPIRED', 'This pairing link has expired. Refresh the device check page for a new code.');
        assertPhoneAllowed(session.interview);

        // Single use: clear the pairing token and rotate the device token in one conditional update.
        const deviceToken = crypto.randomToken();
        const { count } = await db.mediaSession.updateMany({
          where: { id: session.id, pairingTokenHash: session.pairingTokenHash },
          data: {
            pairingTokenHash: null,
            pairingTokenEncrypted: null,
            pairingExpiresAt: null,
            phoneDeviceTokenHash: crypto.hash(deviceToken),
            phoneStatus: 'PAIRED',
            pairedAt: now(),
            secondaryStatus: 'CONNECTING',
          },
        });
        if (count === 0) throw new AppError(401, 'UNAUTHENTICATED', 'This pairing link was already used.');
        events.publish('media.secondary_connected', { interviewId, status: 'PAIRED', timestamp: now().toISOString() });
        await recordAudit(db, { actorRole: 'CANDIDATE', action: 'media.phone_paired', resourceType: 'interview', resourceId: interviewId });
        return { ...(await issue(interviewId, IDENTITY.secondary(interviewId), phoneGrant)), deviceToken };
      }

      if (!creds.deviceToken) throw Errors.validation('Scan the QR code on your laptop to connect this phone.');
      await verifyPhone(interviewId, creds.deviceToken);
      return issue(interviewId, IDENTITY.secondary(interviewId), phoneGrant);
    },

    verifyPhone,

    /** Pairing info for the candidate view; returns null when no phone camera is used or LiveKit is missing. */
    async pairingFor(interviewId: string, policy: Api.SecondaryCameraPolicy): Promise<Api.PhonePairing | null> {
      if (policy === 'OFF' || !media) return null;
      const session = await ensureMediaSession(db, interviewId);
      if (session.phoneStatus === 'PAIRED') {
        return { url: '', expiresAt: (session.pairedAt ?? now()).toISOString(), status: 'PAIRED' };
      }
      let token: string;
      let expiresAt = session.pairingExpiresAt;
      if (session.pairingTokenEncrypted && expiresAt && expiresAt > now()) {
        token = crypto.decrypt(session.pairingTokenEncrypted);
      } else {
        token = crypto.randomToken();
        expiresAt = new Date(now().getTime() + env.PAIRING_TOKEN_TTL_MINUTES * 60_000);
        await db.mediaSession.update({
          where: { id: session.id },
          data: { pairingTokenHash: crypto.hash(token), pairingTokenEncrypted: crypto.encrypt(token), pairingExpiresAt: expiresAt },
        });
      }
      const base = env.APP_BASE_URL.replace(/\/$/, '');
      return {
        url: `${base}/pair?interview=${encodeURIComponent(interviewId)}&token=${encodeURIComponent(token)}`,
        expiresAt: expiresAt.toISOString(),
        status: session.phoneStatus === 'DISCONNECTED' ? 'DISCONNECTED' : 'NOT_PAIRED',
      };
    },

    /** LiveKit participant_joined/left → camera connection state and reviewable observations. */
    async handleParticipantEvent(evt: MediaWebhookEvent): Promise<void> {
      const identity = evt.participant?.identity;
      if (!identity || (evt.event !== 'participant_joined' && evt.event !== 'participant_left')) return;
      const [role, interviewId] = identity.split(':');
      if (!interviewId || (role !== 'candidate-primary' && role !== 'candidate-secondary')) return;
      const joined = evt.event === 'participant_joined';
      const status = joined ? 'CONNECTED' : 'DISCONNECTED';

      const interview = await db.interview.findUnique({ where: { id: interviewId }, select: { id: true, status: true } });
      if (!interview) return;
      if (role === 'candidate-primary') {
        await db.mediaSession.updateMany({ where: { interviewId }, data: { primaryStatus: status } });
        return;
      }
      await db.mediaSession.updateMany({
        where: { interviewId },
        data: joined
          ? { secondaryStatus: 'CONNECTED', phoneStatus: 'PAIRED', pairedAt: evt.createdAt }
          : { secondaryStatus: 'DISCONNECTED', phoneStatus: 'DISCONNECTED', disconnectedAt: evt.createdAt },
      });
      events.publish(joined ? 'media.secondary_connected' : 'media.secondary_disconnected', {
        interviewId,
        status: joined ? 'PAIRED' : 'DISCONNECTED',
        timestamp: evt.createdAt.toISOString(),
      });
      if (isLive(interview.status) && !isFinished(interview.status)) {
        const observation = await db.proctoringEvent.create({
          data: {
            interviewId,
            type: joined ? 'SECONDARY_CONNECTED' : 'SECONDARY_DISCONNECTED',
            occurredAt: evt.createdAt,
            sourceCamera: 'SECONDARY',
            description: joined ? 'Phone camera connected.' : 'Phone camera disconnected.',
          },
        });
        events.publish('proctoring.event_created', {
          interviewId,
          eventId: observation.id,
          type: observation.type,
          sourceCamera: observation.sourceCamera,
          timestamp: observation.occurredAt.toISOString(),
        });
      }
    },
  };
}

export type MediaService = ReturnType<typeof createMediaService>;
