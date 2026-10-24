import type { ApiErrorBody } from '../generated/contract';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method: HttpMethod;
  /** Path relative to the API base, e.g. `/interviews/abc`. */
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

/** Anything that can answer API requests: the real fetch transport or the fixture transport. */
export interface Transport {
  request<T>(options: RequestOptions): Promise<T>;
}

/** Client-side codes that never come from the server. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'ABORTED' | 'BAD_RESPONSE';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, status: number, requestId?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const base = baseUrl.replace(/\/$/, '');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiErrorBody).error?.code === 'string'
  );
}

/**
 * Real transport. Sessions travel in HttpOnly cookies (PRD §2.2), so every request is sent with
 * credentials and no token is ever read or stored by frontend code.
 */
export function createFetchTransport(baseUrl: string): Transport {
  return {
    async request<T>({ method, path, body, query, signal }: RequestOptions): Promise<T> {
      const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
      let response: Response;
      try {
        response = await fetch(buildUrl(baseUrl, path, query), {
          method,
          credentials: 'include',
          signal,
          headers: {
            Accept: 'application/json',
            ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
        });
      } catch (cause) {
        if (signal?.aborted) throw new ApiError('ABORTED', 'Request was cancelled.', 0);
        throw new ApiError(
          'NETWORK_ERROR',
          'Could not reach the HireByte service. Check your connection and try again.',
          0,
          undefined,
          { cause: String(cause) },
        );
      }

      if (response.status === 204) return undefined as T;

      let payload: unknown = null;
      const text = await response.text();
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }

      if (!response.ok) {
        if (isErrorBody(payload)) {
          const { code, message, requestId, details } = payload.error;
          throw new ApiError(code, message, response.status, requestId, details);
        }
        throw new ApiError(
          response.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'BAD_RESPONSE',
          response.status >= 500
            ? 'The service is temporarily unavailable. Please try again shortly.'
            : `Unexpected response from the server (HTTP ${response.status}).`,
          response.status,
        );
      }

      if (payload === null && text) {
        throw new ApiError('BAD_RESPONSE', 'The server returned a response the app could not read.', response.status);
      }
      return payload as T;
    },
  };
}
