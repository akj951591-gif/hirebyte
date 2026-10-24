import type { Env } from './config/env.js';
import type { Crypto } from './lib/crypto.js';
import type { DocumentExtractor } from './providers/documents/documentService.provider.js';
import type { LlmProvider } from './providers/llm/llm.types.js';
import type { EgressProvider } from './providers/media/egress.provider.js';
import type { MediaProvider, WebhookVerifier } from './providers/media/livekit.provider.js';
import type { ObjectStorage } from './providers/object-storage/objectStorage.types.js';
import type { EventHub } from './realtime/eventHub.js';
import type { Db } from './repositories/prisma.js';

/**
 * Everything the app needs from the outside world. Providers are null when not configured, and the
 * API then answers with an explicit "not configured" error instead of pretending (PRD §6.3).
 */
export interface AppDeps {
  env: Env;
  db: Db;
  crypto: Crypto;
  media: MediaProvider | null;
  egress: EgressProvider | null;
  storage: ObjectStorage | null;
  webhooks: WebhookVerifier | null;
  /** Python document service (resume text). */
  documents: DocumentExtractor | null;
  /** Grok: question generation and evaluation. */
  llm: LlmProvider | null;
  /** Socket.IO events (PRD §11.2); a no-op until the realtime server attaches. */
  events: EventHub;
  now: () => Date;
}
