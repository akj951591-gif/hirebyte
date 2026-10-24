import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { appConfig } from '@/config/app.config';
import { featureFlags } from '@/config/featureFlags';
import type { RealtimeEventMap, RealtimeEventName, RealtimeRole } from '../generated/contract';

/**
 * Live updates from the API (PRD §11.2, backend/contracts/events.md). The socket sits under the API
 * base path, so the dev proxy forwards it and the HttpOnly session cookies authenticate it; no token
 * is handled here. Pages keep a fallback poll for whenever the socket is not connected (fixture
 * mode, network loss, signed out).
 */
function endpoint(): { url: string | undefined; path: string } {
  const base = appConfig.apiBaseUrl.replace(/\/$/, '');
  if (/^https?:\/\//.test(base)) {
    const parsed = new URL(base);
    return { url: parsed.origin, path: `${parsed.pathname.replace(/\/$/, '')}/socket.io` };
  }
  return { url: undefined, path: `${base}/socket.io` };
}

const sockets = new Map<RealtimeRole, Socket>();

function socketFor(role: RealtimeRole): Socket {
  let socket = sockets.get(role);
  if (!socket) {
    const { url, path } = endpoint();
    const options = { path, withCredentials: true, auth: { role } };
    socket = url ? io(url, options) : io(options);
    sockets.set(role, socket);
  }
  // A rejected handshake (e.g. a socket opened just before sign-in) is not retried automatically.
  if (!socket.connected && !socket.active) socket.connect();
  return socket;
}

/** Closes a role's socket (on sign-out) so the next session starts a fresh, correctly scoped one. */
export function disconnectRealtime(role: RealtimeRole): void {
  sockets.get(role)?.disconnect();
  sockets.delete(role);
}

/** Listens for `events` while mounted and reports whether the socket is connected. */
export function useRealtime<E extends RealtimeEventName>(
  role: RealtimeRole,
  events: readonly E[],
  handler: (event: E, payload: RealtimeEventMap[E]) => void,
  enabled = true,
): { connected: boolean } {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  const [connected, setConnected] = useState(false);
  const active = enabled && !featureFlags.useFixtures;
  const key = events.join('|');

  useEffect(() => {
    if (!active) return;
    const socket = socketFor(role);
    const listeners = (key.split('|') as E[]).map((name) => {
      const listener = (payload: RealtimeEventMap[E]) => handlerRef.current(name, payload);
      socket.on(name as string, listener);
      return [name as string, listener] as const;
    });
    const up = () => setConnected(true);
    const down = () => setConnected(false);
    socket.on('connect', up);
    socket.on('disconnect', down);
    socket.on('connect_error', down);
    setConnected(socket.connected);
    return () => {
      for (const [name, listener] of listeners) socket.off(name, listener);
      socket.off('connect', up);
      socket.off('disconnect', down);
      socket.off('connect_error', down);
    };
  }, [active, role, key]);

  return { connected: active && connected };
}

/**
 * Calls `refresh` when a matching event arrives, once per burst (an answer and the next question
 * arrive together). With `interviewId`, events about other interviews are ignored.
 */
export function useRealtimeRefresh<E extends RealtimeEventName>(
  role: RealtimeRole,
  events: readonly E[],
  refresh: () => void,
  options: { enabled?: boolean; interviewId?: string } = {},
): { connected: boolean } {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return useRealtime(
    role,
    events,
    (_event, payload) => {
      if (options.interviewId && payload.interviewId !== options.interviewId) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => refreshRef.current(), 150);
    },
    options.enabled,
  );
}
