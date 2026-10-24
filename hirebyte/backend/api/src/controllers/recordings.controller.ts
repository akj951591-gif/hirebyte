import type { Request, RequestHandler } from 'express';
import { AppError, Errors } from '../lib/errors.js';
import { mediaTokenSchema } from '../schemas/recording.schema.js';
import type { Services } from '../services/index.js';
import { RECRUITER_COOKIE } from '../services/auth/auth.service.js';
import { CANDIDATE_COOKIE } from '../services/auth/candidateSession.service.js';
import { uuidParam } from './params.js';

const user = (req: Request) => {
  if (!req.user) throw Errors.unauthenticated();
  return req.user;
};

export function recordingsController(s: Services) {
  /**
   * POST /interviews/:id/media-token. Exactly one credential decides the role: recruiter cookie
   * (viewer), candidate cookie (laptop), or for the phone a one-time pairing token, then its device token.
   */
  const mediaToken: RequestHandler = async (req, res) => {
    const interviewId = uuidParam(req, 'id');
    const body = mediaTokenSchema.parse(req.body ?? {});

    if (body.device === 'secondary') {
      res.json(await s.media.tokenForPhone(interviewId, { pairingToken: body.pairingToken, deviceToken: body.deviceToken }));
      return;
    }
    if (body.device === 'viewer') {
      const recruiter = await s.auth.authenticate(req.cookies?.[RECRUITER_COOKIE]);
      if (!recruiter) throw Errors.unauthenticated();
      res.json(await s.media.tokenForRecruiter(recruiter, interviewId));
      return;
    }
    const candidate = await s.candidates.authenticate(req.cookies?.[CANDIDATE_COOKIE]).catch(() => {
      throw new AppError(401, 'SESSION_EXPIRED', 'Your interview session has ended. Please sign in again.');
    });
    res.json(await s.media.tokenForCandidate(candidate, interviewId));
  };

  return {
    mediaToken,
    list: (async (req, res) => res.json(await s.recordings.list(user(req), uuidParam(req, 'id')))) as RequestHandler,
    start: (async (req, res) => res.json(await s.recordings.retryStart(user(req), uuidParam(req, 'id')))) as RequestHandler,
    playbackUrl: (async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await s.playback.playbackUrl(user(req), uuidParam(req, 'recordingId')));
    }) as RequestHandler,
    remove: (async (req, res) => res.json(await s.playback.remove(user(req), uuidParam(req, 'recordingId')))) as RequestHandler,
  };
}
