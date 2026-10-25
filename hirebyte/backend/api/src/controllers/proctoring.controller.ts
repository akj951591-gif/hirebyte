import type { RequestHandler } from 'express';
import { Errors } from '../lib/errors.js';
import { phoneEventSchema, proctoringEventSchema } from '../schemas/answer.schema.js';
import { reviewProctoringEventSchema } from '../schemas/evaluation.schema.js';
import type { Services } from '../services/index.js';
import { uuidParam } from './params.js';

export function proctoringController(s: Services) {
  return {
    /** Candidate-scoped: a candidate can only log observations on their own interview. */
    create: (async (req, res) => {
      if (!req.candidate) throw Errors.unauthenticated();
      res.status(201).json(await s.candidateFlow.logEvent(req.candidate, uuidParam(req, 'id'), proctoringEventSchema.parse(req.body)));
    }) as RequestHandler,
    /** Phone-scoped: the phone has no cookie, so its device token (from pairing) is in the body. */
    createFromPhone: (async (req, res) => {
      const { deviceToken, ...body } = phoneEventSchema.parse(req.body ?? {});
      res.status(201).json(await s.candidateFlow.logPhoneEvent(uuidParam(req, 'id'), deviceToken, body));
    }) as RequestHandler,
    review: (async (req, res) => {
      if (!req.user) throw Errors.unauthenticated();
      res.json(await s.evaluations.reviewEvent(req.user, uuidParam(req, 'id'), reviewProctoringEventSchema.parse(req.body)));
    }) as RequestHandler,
  };
}
