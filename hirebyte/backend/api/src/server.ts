import 'dotenv/config';
import { createApp } from './app.js';
import { ConfigError, describeEnv, loadEnv } from './config/env.js';
import { createDeps } from './deps.js';
import { configureLogger, logger, safeError } from './lib/logger.js';
import { createRealtimeServer } from './realtime/socketServer.js';

const OVERDUE_SWEEP_MS = 60_000;
/** An evaluation still EVALUATING after this long without an active job is considered lost. */
const STUCK_EVALUATION_MS = 15 * 60_000;

function main() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`${err.message}\n\nCopy backend/api/.env.example to backend/api/.env and fill it in.`);
      process.exit(1);
    }
    throw err;
  }
  configureLogger(env.LOG_LEVEL);

  const deps = createDeps(env);
  const { app, services } = createApp(deps);
  const server = app.listen(env.PORT, () => {
    logger.info('HireByte API listening', { port: env.PORT, ...describeEnv(env) });
  });
  // Live updates for the dashboards (PRD §11.2) share the HTTP server and the session cookies.
  const io = createRealtimeServer(server, deps, services);

  // Evaluation jobs run in this process, so any left EVALUATING by a previous run were interrupted.
  services.evaluationRunner
    .failInterrupted(0)
    .then((count) => count > 0 && logger.warn('marked interrupted evaluations as failed', { count }))
    .catch((err) => logger.warn('interrupted evaluation check failed', safeError(err)));

  // Ends interviews whose time limit passed while the candidate was away (closed tab, lost network),
  // and fails evaluations that stopped making progress.
  const sweep = setInterval(() => {
    services.candidateFlow
      .expireOverdue()
      .then((count) => count > 0 && logger.info('ended overdue interviews', { count }))
      .catch((err) => logger.warn('overdue interview sweep failed', safeError(err)));
    services.evaluationRunner
      .failInterrupted(STUCK_EVALUATION_MS)
      .then((count) => count > 0 && logger.warn('marked stuck evaluations as failed', { count }))
      .catch((err) => logger.warn('stuck evaluation sweep failed', safeError(err)));
    // Recordings: keep status in step with LiveKit, and delete those past their retention date.
    services.recordings
      .reconcileActive()
      .catch((err) => logger.warn('recording reconcile sweep failed', safeError(err)));
    services.recordings
      .deleteExpired()
      .then(({ deleted, failed }) => (deleted || failed) && logger.info('recording retention sweep', { deleted, failed }))
      .catch((err) => logger.warn('recording retention sweep failed', safeError(err)));
  }, OVERDUE_SWEEP_MS);
  sweep.unref();

  const shutdown = (signal: string) => {
    logger.info('shutting down', { signal });
    clearInterval(sweep);
    // Closes every socket and then the HTTP server.
    void io.close(() => {
      deps.db.$disconnect().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => logger.error('unhandled rejection', safeError(err)));
}

main();
