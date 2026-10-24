import type { CookieOptions, RequestHandler, Response } from 'express';
import type { Env } from '../config/env.js';
import { Errors } from '../lib/errors.js';
import { RECRUITER_COOKIE, type AuthService } from '../services/auth/auth.service.js';

export function recruiterCookieOptions(env: Env, expiresAt?: Date): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: env.isProduction, path: '/', ...(expiresAt ? { expires: expiresAt } : {}) };
}

export function setRecruiterCookie(res: Response, env: Env, token: string, expiresAt: Date) {
  res.cookie(RECRUITER_COOKIE, token, recruiterCookieOptions(env, expiresAt));
}

export function clearRecruiterCookie(res: Response, env: Env) {
  res.clearCookie(RECRUITER_COOKIE, recruiterCookieOptions(env));
}

/** Server-side authorization for every recruiter route (frontend guards are UX only). */
export function requireRecruiter(auth: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const user = await auth.authenticate(req.cookies?.[RECRUITER_COOKIE]);
    if (!user) return next(Errors.unauthenticated());
    req.user = user;
    next();
  };
}
