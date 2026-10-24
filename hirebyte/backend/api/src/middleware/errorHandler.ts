import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@contracts';
import { AppError } from '../lib/errors.js';
import { logger, safeError } from '../lib/logger.js';
import { Prisma } from '../repositories/prisma.js';

function send(res: Parameters<ErrorRequestHandler>[2], status: number, body: ApiErrorBody) {
  res.status(status).json(body);
}

export const notFoundHandler: RequestHandler = (req, res) => {
  send(res, 404, { error: { code: 'NOT_FOUND', message: `No API route for ${req.method} ${req.path}.`, requestId: req.id } });
};

/** One predictable error shape (PRD §11.1). Never returns stack traces, secrets or provider payloads. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.id;

  if (err instanceof AppError) {
    send(res, err.status, { error: { code: err.code, message: err.message, requestId, ...(err.details ? { details: err.details } : {}) } });
    return;
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    const first = err.issues[0]?.message ?? 'Invalid request.';
    send(res, 400, { error: { code: 'VALIDATION_ERROR', message: first, requestId, details: { fields } } });
    return;
  }
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    send(res, tooLarge ? 413 : 400, {
      error: { code: 'VALIDATION_ERROR', message: tooLarge ? 'The file is larger than 5 MB.' : 'Send one file in the form field "resume".', requestId },
    });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    send(res, 404, { error: { code: 'NOT_FOUND', message: 'Resource not found.', requestId } });
    return;
  }
  const type = (err as { type?: string })?.type;
  if (type === 'entity.parse.failed') {
    send(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'The request body is not valid JSON.', requestId } });
    return;
  }
  if (type === 'entity.too.large') {
    send(res, 413, { error: { code: 'VALIDATION_ERROR', message: 'The request is too large.', requestId } });
    return;
  }

  logger.error('unhandled error', { requestId, method: req.method, path: req.path, ...safeError(err) });
  send(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.', requestId } });
};
