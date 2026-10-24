import type { CookieOptions, RequestHandler, Response } from 'express';
import type { Env } from '../config/env.js';
import { CANDIDATE_COOKIE, type CandidateSessionService } from '../services/auth/candidateSession.service.js';

export function candidateCookieOptions(env: Env, expiresAt?: Date): CookieOptions {
  // Scoped to the API so the token is never sent with page requests.
  return { httpOnly: true, sameSite: 'lax', secure: env.isProduction, path: '/api', ...(expiresAt ? { expires: expiresAt } : {}) };
}

export function setCandidateCookie(res: Response, env: Env, token: string, expiresAt: Date) {
  res.cookie(CANDIDATE_COOKIE, token, candidateCookieOptions(env, expiresAt));
}

export function clearCandidateCookie(res: Response, env: Env) {
  res.clearCookie(CANDIDATE_COOKIE, candidateCookieOptions(env));
}

/** Requires a valid candidate session; a `:sessionId` route param must be the caller's own session. */
export function requireCandidateSession(candidates: CandidateSessionService): RequestHandler {
  return async (req, _res, next) => {
    const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : undefined;
    req.candidate = await candidates.authenticate(req.cookies?.[CANDIDATE_COOKIE], sessionId);
    next();
  };
}
