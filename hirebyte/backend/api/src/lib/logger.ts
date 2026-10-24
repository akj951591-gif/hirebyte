/**
 * Minimal structured logger. Callers pass safe metadata only: never passwords, tokens, signed URLs,
 * provider secrets or raw provider payloads (PRD §13).
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: Level = 'info';
let silent = false;

export function configureLogger(level: Level, opts: { silent?: boolean } = {}) {
  threshold = level;
  silent = Boolean(opts.silent);
}

function write(level: Level, message: string, meta?: Record<string, unknown>) {
  if (silent || order[level] < order[threshold]) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...meta });
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => write('debug', m, meta),
  info: (m: string, meta?: Record<string, unknown>) => write('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => write('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => write('error', m, meta),
};

/** Reduce an unknown error to something safe to log (name + message, no stack payloads). */
export function safeError(err: unknown): { errorName: string; errorMessage: string } {
  if (err instanceof Error) return { errorName: err.name, errorMessage: err.message.slice(0, 300) };
  return { errorName: 'Unknown', errorMessage: String(err).slice(0, 300) };
}
