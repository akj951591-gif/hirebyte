import type { Request, RequestHandler } from 'express';
import { Errors } from '../lib/errors.js';
import { createInterviewSchema, listInterviewsQuerySchema, updateInterviewSchema } from '../schemas/interview.schema.js';
import { generateQuestionsSchema, updateQuestionsSchema } from '../schemas/question.schema.js';
import type { Services } from '../services/index.js';
import { uuidParam } from './params.js';

const user = (req: Request) => {
  if (!req.user) throw Errors.unauthenticated();
  return req.user;
};

export function interviewsController(s: Services) {
  return {
    create: (async (req, res) => res.status(201).json(await s.interviews.create(user(req), createInterviewSchema.parse(req.body)))) as RequestHandler,
    list: (async (req, res) => res.json(await s.interviews.list(user(req), listInterviewsQuerySchema.parse(req.query)))) as RequestHandler,
    get: (async (req, res) => res.json(await s.interviews.detail(user(req), uuidParam(req, 'id')))) as RequestHandler,
    update: (async (req, res) =>
      res.json(await s.interviews.update(user(req), uuidParam(req, 'id'), updateInterviewSchema.parse(req.body ?? {})))) as RequestHandler,
    remove: (async (req, res) => {
      await s.interviews.remove(user(req), uuidParam(req, 'id'));
      res.status(204).end();
    }) as RequestHandler,
    cancel: (async (req, res) => res.json(await s.interviews.cancel(user(req), uuidParam(req, 'id')))) as RequestHandler,
    updateQuestions: (async (req, res) =>
      res.json(await s.questions.replace(user(req), uuidParam(req, 'id'), updateQuestionsSchema.parse(req.body)))) as RequestHandler,
    ready: (async (req, res) => res.json(await s.interviews.markReady(user(req), uuidParam(req, 'id')))) as RequestHandler,
    report: (async (req, res) => res.json(await s.reports.report(user(req), uuidParam(req, 'id')))) as RequestHandler,

    uploadResume: (async (req, res) => res.json(await s.resumes.upload(user(req), uuidParam(req, 'id'), req.file))) as RequestHandler,
    generateQuestions: (async (req, res) =>
      res.json(await s.questions.generate(user(req), uuidParam(req, 'id'), generateQuestionsSchema.parse(req.body ?? {})))) as RequestHandler,
    /** 202: the evaluation runs in the background; progress arrives as status events or via the report. */
    evaluate: (async (req, res) => res.status(202).json(await s.evaluationRunner.start(user(req), uuidParam(req, 'id')))) as RequestHandler,
    exportPdf: (async (req, res) => {
      const { filename, pdf } = await s.pdf.export(user(req), uuidParam(req, 'id'));
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
      res.send(pdf);
    }) as RequestHandler,
  };
}
