import type { Request, RequestHandler } from 'express';
import { Errors } from '../lib/errors.js';
import { reviewEvaluationSchema } from '../schemas/evaluation.schema.js';
import type { Services } from '../services/index.js';
import { uuidParam } from './params.js';

const user = (req: Request) => {
  if (!req.user) throw Errors.unauthenticated();
  return req.user;
};

export function evaluationController(s: Services) {
  return {
    review: (async (req, res) =>
      res.json(await s.evaluations.review(user(req), uuidParam(req, 'id'), reviewEvaluationSchema.parse(req.body)))) as RequestHandler,
  };
}
