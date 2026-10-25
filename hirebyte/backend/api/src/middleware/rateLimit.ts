import { rateLimit } from 'express-rate-limit';
import type { Env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

/** IP-based limits for login and invitation checks (PRD §2.4); account/invitation lockouts add a second layer. */
function limiter(env: Env, limit: number, message: string) {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: env.NODE_ENV === 'test' ? 10_000 : limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', message)),
  });
}

export const loginRateLimit = (env: Env) => limiter(env, 20, 'Too many sign-in attempts. Please wait a few minutes and try again.');
export const registerRateLimit = (env: Env) => limiter(env, 10, 'Too many accounts were created from this network. Please wait a while and try again.');
export const candidateAccessRateLimit =(env: Env) => limiter(env, 30, 'Too many attempts. Please wait a few minutes and try again.');
