import type { CandidateRealtimeEventName, InterviewStatus, RealtimeEventMap, RealtimeEventName } from '@contracts';
import type { Server } from 'socket.io';
import { logger, safeError } from '../lib/logger.js';
import type { Db } from '../repositories/prisma.js';

/** What services see: publish after the database change has committed. Never throws. */
export interface EventPublisher {
  publish<E extends RealtimeEventName>(event: E, payload: RealtimeEventMap[E]): void;
}

export interface EventHub extends EventPublisher {
  /** Connects the hub to Socket.IO once the HTTP server is listening; until then events are dropped. */
  attach(io: Server): void;
  /** Resolves when every event published so far has been delivered (used by tests and shutdown). */
  flush(): Promise<void>;
}

/** `interview.status_changed`, published after a committed state-machine transition. */
export function publishStatus(events: EventPublisher, interviewId: string, status: InterviewStatus, at: Date): void {
  events.publish('interview.status_changed', { interviewId, status, timestamp: at.toISOString() });
}

/** `interview.question_changed` when the candidate moves to a new question (none after the last one). */
export function publishQuestion(events: EventPublisher, interviewId: string, question: { id: string; sequence: number } | null, at: Date): void {
  if (!question) return;
  events.publish('interview.question_changed', { interviewId, questionId: question.id, sequence: question.sequence, timestamp: at.toISOString() });
}

export const rooms = {
  recruiter: (userId: string) => `recruiter:${userId}`,
  admins: 'admins',
  candidate: (interviewId: string) => `candidate:${interviewId}`,
};

const CANDIDATE_EVENTS: ReadonlySet<RealtimeEventName> = new Set<CandidateRealtimeEventName>([
  'interview.status_changed',
  'media.secondary_connected',
  'media.secondary_disconnected',
]);
const OWNER_CACHE_LIMIT = 5_000;

/**
 * Routes each event to the interview owner's recruiter room and the admins room, plus the candidate
 * room for the few candidate-safe events (PRD §11.2: never broadcast unrelated candidate data).
 * Deliveries run one after another so clients see events in the order they happened.
 */
export function createEventHub(db: Db): EventHub {
  let io: Server | null = null;
  let queue: Promise<void> = Promise.resolve();
  const owners = new Map<string, string>();

  async function ownerOf(interviewId: string): Promise<string | null> {
    const cached = owners.get(interviewId);
    if (cached) return cached;
    const row = await db.interview.findUnique({ where: { id: interviewId }, select: { recruiterId: true } });
    if (!row) return null;
    if (owners.size >= OWNER_CACHE_LIMIT) owners.clear();
    owners.set(interviewId, row.recruiterId);
    return row.recruiterId;
  }

  async function deliver<E extends RealtimeEventName>(server: Server, event: E, payload: RealtimeEventMap[E]) {
    const owner = await ownerOf(payload.interviewId);
    if (!owner) return;
    server.to([rooms.recruiter(owner), rooms.admins]).emit(event, payload);
    if (CANDIDATE_EVENTS.has(event)) server.to(rooms.candidate(payload.interviewId)).emit(event, payload);
  }

  return {
    attach(server) {
      io = server;
    },
    publish(event, payload) {
      const server = io;
      if (!server) return;
      queue = queue
        .then(() => deliver(server, event, payload))
        .catch((err) => logger.warn('realtime delivery failed', { event, ...safeError(err) }));
    },
    flush: () => queue,
  };
}
