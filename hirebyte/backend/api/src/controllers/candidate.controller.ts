import type { Request, RequestHandler } from 'express';
import type { Env } from '../config/env.js';
import { Errors } from '../lib/errors.js';
import { clearCandidateCookie, setCandidateCookie } from '../middleware/requireCandidateSession.js';
import { consentSchema, skipQuestionSchema, submitAnswerSchema } from '../schemas/answer.schema.js';
import { candidateAccessSchema } from '../schemas/auth.schema.js';
import { CANDIDATE_COOKIE } from '../services/auth/candidateSession.service.js';
import type { Services } from '../services/index.js';

const ctx = (req: Request) => {
  if (!req.candidate) throw Errors.unauthenticated();
  return req.candidate;
};

export function candidateController(s: Services, env: Env) {
  const access: RequestHandler = async (req, res) => {
    const { invitationCode, accessCode } = candidateAccessSchema.parse(req.body);
    const { sessionId, token, expiresAt } = await s.candidates.access(invitationCode, accessCode);
    setCandidateCookie(res, env, token, expiresAt);
    res.json({ sessionId, expiresAt: expiresAt.toISOString() });
  };

  const logout: RequestHandler = async (req, res) => {
    await s.candidates.logout(req.cookies?.[CANDIDATE_COOKIE]);
    clearCandidateCookie(res, env);
    res.status(204).end();
  };

  return {
    access,
    logout,
    session: (async (req, res) => res.json(await s.candidateFlow.view(ctx(req)))) as RequestHandler,
    consent: (async (req, res) => res.json(await s.candidateFlow.consent(ctx(req), consentSchema.parse(req.body)))) as RequestHandler,
    start: (async (req, res) => res.json(await s.candidateFlow.start(ctx(req)))) as RequestHandler,
    current: (async (req, res) => res.json(await s.candidateFlow.current(ctx(req)))) as RequestHandler,
    answer: (async (req, res) => res.json(await s.candidateFlow.submitAnswer(ctx(req), submitAnswerSchema.parse(req.body)))) as RequestHandler,
    skip: (async (req, res) => res.json(await s.candidateFlow.skip(ctx(req), skipQuestionSchema.parse(req.body)))) as RequestHandler,
    complete: (async (req, res) => res.json(await s.candidateFlow.complete(ctx(req)))) as RequestHandler,
  };
}
