import type { AppDeps } from '../../context.js';
import { AppError, Errors } from '../../lib/errors.js';
import { recordAudit } from '../../repositories/auditEvent.repository.js';
import { isFinished, transitionInterview } from '../interviews/stateMachine.js';
import { ensureMediaSession } from '../media/media.service.js';
import { publishStatus } from '../../realtime/eventHub.js';

export const CANDIDATE_COOKIE = 'hb_candidate';
const MAX_ACCESS_ATTEMPTS = 5;

export interface CandidateContext {
  sessionId: string;
  interviewId: string;
}

const invalidInvitation = () =>
  new AppError(401, 'INVITATION_INVALID', 'We could not find an interview for that invitation and access code.');

/** Candidate access by invitation code + access code; issues a narrowly scoped session (PRD §2.1). */
export function createCandidateSessionService(deps: AppDeps) {
  const { db, crypto, env, now, events } = deps;

  return {
    async access(invitationCode: string, accessCode: string): Promise<{ sessionId: string; token: string; expiresAt: Date }> {
      const invitation = await db.invitation.findUnique({
        where: { code: invitationCode.trim().toUpperCase() },
        include: { interview: { select: { id: true, status: true } } },
      });
      if (!invitation) {
        await recordAudit(db, { actorRole: 'ANONYMOUS', action: 'candidate.access_failed', resourceType: 'invitation', metadata: { reason: 'unknown_code' } });
        throw invalidInvitation();
      }
      if (invitation.lockedAt) {
        throw new AppError(423, 'SESSION_LOCKED', 'This interview session is locked after too many attempts. Please contact the recruiter.');
      }

      if (!crypto.matches(accessCode.trim(), invitation.accessCodeHash)) {
        const attempts = invitation.failedAttempts + 1;
        const lock = attempts >= MAX_ACCESS_ATTEMPTS;
        await db.invitation.update({
          where: { id: invitation.id },
          data: { failedAttempts: attempts, lockedAt: lock ? now() : null },
        });
        await recordAudit(db, {
          actorRole: 'ANONYMOUS',
          action: lock ? 'candidate.invitation_locked' : 'candidate.access_failed',
          resourceType: 'interview',
          resourceId: invitation.interviewId,
        });
        if (lock) throw new AppError(423, 'SESSION_LOCKED', 'This interview session is locked after too many attempts. Please contact the recruiter.');
        throw invalidInvitation();
      }

      const { interview } = invitation;
      if (isFinished(interview.status)) throw new AppError(409, 'INTERVIEW_COMPLETED', 'This interview has already been completed.');
      if (interview.status === 'CANCELLED' || interview.status === 'DRAFT') {
        throw new AppError(410, 'INVITATION_EXPIRED', 'This invitation is no longer active.');
      }
      if (invitation.expiresAt <= now() && interview.status === 'READY') {
        // An interview that already started can be resumed after the invitation window closes.
        throw new AppError(410, 'INVITATION_EXPIRED', 'This invitation has expired. Please ask the recruiter for a new one.');
      }

      const token = crypto.randomToken();
      const expiresAt = new Date(now().getTime() + env.CANDIDATE_SESSION_TTL_MINUTES * 60_000);
      const { session, opened } = await db.$transaction(async (tx) => {
        await tx.invitation.update({ where: { id: invitation.id }, data: { failedAttempts: 0 } });
        // No-op when the candidate is resuming (already ONBOARDING or later).
        const opened = await transitionInterview(tx, interview.id, 'READY', 'ONBOARDING');
        await ensureMediaSession(tx, interview.id);
        const session = await tx.candidateSession.create({ data: { interviewId: interview.id, tokenHash: crypto.hash(token), expiresAt } });
        return { session, opened };
      });
      if (opened) publishStatus(events, interview.id, 'ONBOARDING', now());
      await recordAudit(db, { actorId: session.id, actorRole: 'CANDIDATE', action: 'candidate.access', resourceType: 'interview', resourceId: interview.id });
      return { sessionId: session.id, token, expiresAt };
    },

    /** Validates the candidate cookie; when `sessionId` is given it must be the caller's own session. */
    async authenticate(token: string | undefined, sessionId?: string): Promise<CandidateContext> {
      if (!token) throw new AppError(401, 'SESSION_EXPIRED', 'Your interview session has ended. Please sign in again.');
      const session = await db.candidateSession.findUnique({ where: { tokenHash: crypto.hash(token) } });
      if (!session || session.status !== 'ACTIVE' || session.expiresAt <= now()) {
        throw new AppError(401, 'SESSION_EXPIRED', 'Your interview session has ended. Please sign in again.');
      }
      if (sessionId !== undefined && sessionId !== session.id) throw Errors.forbidden('This session does not belong to you.');
      await db.candidateSession.update({ where: { id: session.id }, data: { lastAccessAt: now() } });
      return { sessionId: session.id, interviewId: session.interviewId };
    },

    async logout(token: string | undefined): Promise<void> {
      if (!token) return;
      await db.candidateSession.updateMany({ where: { tokenHash: crypto.hash(token), status: 'ACTIVE' }, data: { status: 'ENDED' } });
    },
  };
}

export type CandidateSessionService = ReturnType<typeof createCandidateSessionService>;
