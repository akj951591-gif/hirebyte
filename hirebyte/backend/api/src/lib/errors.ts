import type { ApiErrorCode } from '@contracts';

/** Errors thrown by services; the error handler turns them into the PRD §11.1 JSON shape. */
export class AppError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: ApiErrorCode | string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  validation: (message = 'Please fix the highlighted fields.', fields?: Record<string, string>) =>
    new AppError(400, 'VALIDATION_ERROR', message, fields ? { fields } : undefined),
  unauthenticated: (message = 'Please sign in to continue.') => new AppError(401, 'UNAUTHENTICATED', message),
  forbidden: (message = 'You do not have access to this resource.') => new AppError(403, 'FORBIDDEN', message),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`),
  conflict: (message: string, code: ApiErrorCode | string = 'CONFLICT') => new AppError(409, code, message),
  notConfigured: (code: ApiErrorCode | string, message: string) => new AppError(503, code, message),
};
