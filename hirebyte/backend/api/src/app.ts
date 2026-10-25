import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { describeEnv } from './config/env.js';
import type { AppDeps } from './context.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRoutes, routeContext, webhookRoutes } from './routes/index.js';
import { createServices } from './services/index.js';

export function createApp(deps: AppDeps) {
  const services = createServices(deps);
  const ctx = routeContext(deps, services);
  const app = express();

  app.disable('x-powered-by');
  // The Vite dev proxy (and most hosts) forward from loopback; needed for correct client IPs in rate limits.
  // Deployed behind other proxies (CloudFront → nginx), TRUST_PROXY_HOPS says how many to trust instead.
  app.set('trust proxy', deps.env.TRUST_PROXY_HOPS ?? 'loopback');
  app.use((req, res, next) => {
    req.id = randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  app.use(helmet());
  app.use(cors({ origin: deps.env.WEB_ORIGIN.split(',').map((o) => o.trim()), credentials: true }));
  app.use(cookieParser());

  /** Public health check (PRD §2.3): reports configuration state, never secrets. */
  app.get('/api/health', async (_req, res) => {
    let database: 'ok' | 'error' = 'ok';
    try {
      await deps.db.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }
    res.status(database === 'ok' ? 200 : 503).json({ status: database === 'ok' ? 'ok' : 'degraded', database, ...describeEnv(deps.env) });
  });

  app.use('/api', webhookRoutes(ctx));
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', apiRoutes(ctx));
  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return { app, services };
}
