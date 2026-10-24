import type { Server as HttpServer } from 'node:http';
import type { RealtimeRole } from '@contracts';
import { Server, type Socket } from 'socket.io';
import type { AppDeps } from '../context.js';
import { logger, safeError } from '../lib/logger.js';
import { RECRUITER_COOKIE, type AuthUser } from '../services/auth/auth.service.js';
import { CANDIDATE_COOKIE, type CandidateContext } from '../services/auth/candidateSession.service.js';
import type { Services } from '../services/index.js';
import { rooms } from './eventHub.js';

/** Under /api so the Vite proxy forwards it and the candidate cookie (path=/api) is sent. */
export const REALTIME_PATH = '/api/socket.io';

type SocketIdentity =
  | { role: 'recruiter'; user: AuthUser; token: string }
  | { role: 'candidate'; candidate: CandidateContext; token: string };

export interface RealtimeOptions {
  /** How often a connected socket's session is re-checked (logout, expiry, cancelled interview). */
  revalidateMs?: number;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // Ignore cookies that are not URI-encoded; they are not ours.
    }
  }
  return out;
}

/**
 * Socket.IO server for PRD §11.2 events. Every connection must present a valid recruiter or
 * candidate session cookie; rooms are joined by the server, never chosen by the client, so a socket
 * can only ever receive events it is authorized for.
 */
export function createRealtimeServer(httpServer: HttpServer, deps: AppDeps, services: Services, options: RealtimeOptions = {}) {
  const revalidateMs = options.revalidateMs ?? 30_000;
  const io = new Server(httpServer, {
    path: REALTIME_PATH,
    serveClient: false,
    cors: { origin: deps.env.WEB_ORIGIN.split(',').map((o) => o.trim()), credentials: true },
  });

  async function identify(role: unknown, cookies: Record<string, string>): Promise<SocketIdentity | null> {
    if (role === 'recruiter') {
      const token = cookies[RECRUITER_COOKIE];
      const user = token ? await services.auth.authenticate(token) : null;
      return user && token ? { role, user, token } : null;
    }
    if (role === 'candidate') {
      const token = cookies[CANDIDATE_COOKIE];
      if (!token) return null;
      const candidate = await services.candidates.authenticate(token).catch(() => null);
      return candidate ? { role, candidate, token } : null;
    }
    return null;
  }

  async function stillValid(identity: SocketIdentity): Promise<boolean> {
    if (identity.role === 'recruiter') return (await services.auth.authenticate(identity.token)) !== null;
    return (await services.candidates.authenticate(identity.token).catch(() => null)) !== null;
  }

  io.use(async (socket, next) => {
    try {
      const role = (socket.handshake.auth as { role?: RealtimeRole } | undefined)?.role;
      const identity = await identify(role, parseCookies(socket.request.headers.cookie));
      if (!identity) return next(new Error('UNAUTHENTICATED'));
      socket.data.identity = identity;
      next();
    } catch (err) {
      logger.warn('realtime handshake failed', safeError(err));
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const identity = socket.data.identity as SocketIdentity;
    if (identity.role === 'recruiter') {
      void socket.join(identity.user.role === 'ADMIN' ? rooms.admins : rooms.recruiter(identity.user.id));
    } else {
      void socket.join(rooms.candidate(identity.candidate.interviewId));
    }

    const timer = setInterval(() => {
      stillValid(identity)
        .then((ok) => {
          if (!ok) socket.disconnect(true);
        })
        .catch((err) => logger.warn('realtime revalidation failed', safeError(err)));
    }, revalidateMs);
    socket.on('disconnect', () => clearInterval(timer));
  });

  deps.events.attach(io);
  return io;
}
