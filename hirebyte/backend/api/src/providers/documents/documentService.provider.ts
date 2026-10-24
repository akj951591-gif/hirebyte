import type { Env } from '../../config/env.js';

export interface ExtractedDocument {
  text: string;
  pageCount: number;
  truncated: boolean;
  warnings: string[];
}

/** The document was refused (unsupported, password-protected, no text…). `code` comes from the service. */
export class DocumentRejectedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly unsupportedType: boolean,
  ) {
    super(message);
    this.name = 'DocumentRejectedError';
  }
}

/** The service could not be reached, timed out or failed internally. */
export class DocumentServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentServiceUnavailableError';
  }
}

/** Python FastAPI document service (PRD §3): text extraction only, no interview state. */
export interface DocumentExtractor {
  extract(file: { buffer: Buffer; filename: string; mimeType: string }): Promise<ExtractedDocument>;
}

export function createDocumentServiceClient(env: Env): DocumentExtractor | null {
  if (!env.DOCUMENT_SERVICE_URL) return null;
  const endpoint = `${env.DOCUMENT_SERVICE_URL.replace(/\/$/, '')}/extract`;

  return {
    async extract(file) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.filename);
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          body: form,
          headers: env.DOCUMENT_SERVICE_TOKEN ? { 'X-Service-Token': env.DOCUMENT_SERVICE_TOKEN } : {},
          signal: AbortSignal.timeout(env.DOCUMENT_TIMEOUT_MS),
        });
      } catch (err) {
        const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
        throw new DocumentServiceUnavailableError(timedOut ? 'The document service timed out.' : 'The document service is unreachable.');
      }

      const body = (await res.json().catch(() => null)) as
        | (ExtractedDocument & { error?: undefined })
        | { error?: { code?: string; message?: string } }
        | null;
      if (res.ok && body && 'text' in body) {
        return { text: body.text, pageCount: body.pageCount, truncated: body.truncated, warnings: body.warnings ?? [] };
      }
      const error = body && 'error' in body ? body.error : undefined;
      // 4xx: the document itself is the problem. 401 means our token is wrong, which is a setup issue.
      if (res.status >= 400 && res.status < 500 && res.status !== 401 && error?.code) {
        throw new DocumentRejectedError(error.code, error.message ?? 'The document could not be read.', res.status === 415);
      }
      throw new DocumentServiceUnavailableError(`The document service failed (HTTP ${res.status}).`);
    },
  };
}
