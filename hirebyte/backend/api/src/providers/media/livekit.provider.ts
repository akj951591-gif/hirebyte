import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver, EgressStatus, type WebhookEvent } from 'livekit-server-sdk';
import type { Env } from '../../config/env.js';

export interface MediaTokenRequest {
  room: string;
  identity: string;
  name?: string;
  canPublish: boolean;
  canSubscribe: boolean;
  /** Restrict publishing to these sources (e.g. phone: camera only). */
  sources?: Array<'camera' | 'microphone'>;
  hidden?: boolean;
  ttlSeconds: number;
}

/** Short-lived, room-scoped LiveKit credentials. The API secret never leaves the server (PRD §2.4). */
export interface MediaProvider {
  readonly url: string;
  createToken(req: MediaTokenRequest): Promise<string>;
  ensureRoom(room: string): Promise<void>;
}

export type EgressState = 'STARTING' | 'ACTIVE' | 'ENDING' | 'COMPLETE' | 'FAILED' | 'ABORTED' | 'LIMIT_REACHED';

/** Provider-neutral view of a webhook delivery; raw payloads are never stored or logged. */
export interface MediaWebhookEvent {
  id: string;
  event: string;
  createdAt: Date;
  egress?: {
    egressId: string;
    roomName: string;
    state: EgressState;
    error: string | null;
    file: { filename: string; sizeBytes: number | null; durationSeconds: number | null } | null;
  };
  participant?: { identity: string };
  roomName?: string;
}

export interface WebhookVerifier {
  /** Verifies the signature and parses the body; throws on an invalid or missing signature. */
  receive(rawBody: string, authorization: string | undefined): Promise<MediaWebhookEvent>;
}

/** wss://x.livekit.cloud → https://x.livekit.cloud for the server APIs. */
export function livekitHttpUrl(url: string): string {
  return url.replace(/^ws(s?):\/\//, 'http$1://');
}

const egressStates: Record<number, EgressState> = {
  [EgressStatus.EGRESS_STARTING]: 'STARTING',
  [EgressStatus.EGRESS_ACTIVE]: 'ACTIVE',
  [EgressStatus.EGRESS_ENDING]: 'ENDING',
  [EgressStatus.EGRESS_COMPLETE]: 'COMPLETE',
  [EgressStatus.EGRESS_FAILED]: 'FAILED',
  [EgressStatus.EGRESS_ABORTED]: 'ABORTED',
  [EgressStatus.EGRESS_LIMIT_REACHED]: 'LIMIT_REACHED',
};

export function toEgressState(status: number): EgressState {
  return egressStates[status] ?? 'FAILED';
}

export function normalizeWebhookEvent(evt: WebhookEvent): MediaWebhookEvent {
  const info = evt.egressInfo;
  const file = info?.fileResults?.[0];
  return {
    id: evt.id,
    event: evt.event,
    createdAt: evt.createdAt ? new Date(Number(evt.createdAt) * 1000) : new Date(),
    egress: info
      ? {
          egressId: info.egressId,
          roomName: info.roomName,
          state: toEgressState(info.status),
          error: info.error || null,
          file: file
            ? {
                filename: file.filename,
                sizeBytes: file.size ? Number(file.size) : null,
                // LiveKit reports duration in nanoseconds.
                durationSeconds: file.duration ? Number(file.duration) / 1e9 : null,
              }
            : null,
        }
      : undefined,
    participant: evt.participant ? { identity: evt.participant.identity } : undefined,
    roomName: evt.room?.name ?? info?.roomName,
  };
}

export function createLiveKitProvider(env: Env): MediaProvider | null {
  if (!env.livekitConfigured) return null;
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = env as Required<Pick<Env, 'LIVEKIT_URL' | 'LIVEKIT_API_KEY' | 'LIVEKIT_API_SECRET'>>;
  const rooms = new RoomServiceClient(livekitHttpUrl(LIVEKIT_URL), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

  return {
    url: LIVEKIT_URL,
    async createToken(req) {
      const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: req.identity,
        name: req.name,
        ttl: req.ttlSeconds,
      });
      token.addGrant({
        room: req.room,
        roomJoin: true,
        canPublish: req.canPublish,
        canSubscribe: req.canSubscribe,
        canPublishData: false,
        hidden: req.hidden ?? false,
        canPublishSources: req.sources?.map((s) => (s === 'camera' ? TrackSource.CAMERA : TrackSource.MICROPHONE)),
      });
      return token.toJwt();
    },
    async ensureRoom(room) {
      // Idempotent on LiveKit's side: returns the existing room if it is already open.
      await rooms.createRoom({ name: room, emptyTimeout: 10 * 60, maxParticipants: 6 });
    },
  };
}

export function createLiveKitWebhookVerifier(env: Env): WebhookVerifier | null {
  if (!env.livekitConfigured) return null;
  // LiveKit signs webhooks with the project API key/secret (JWT over a SHA-256 of the body).
  const receiver = new WebhookReceiver(env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!);
  return {
    async receive(rawBody, authorization) {
      const evt = await receiver.receive(rawBody, authorization);
      return normalizeWebhookEvent(evt);
    },
  };
}
