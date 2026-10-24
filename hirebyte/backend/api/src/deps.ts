import type { Env } from './config/env.js';
import type { AppDeps } from './context.js';
import { createCrypto } from './lib/crypto.js';
import { createDocumentServiceClient } from './providers/documents/documentService.provider.js';
import { createGrokProvider } from './providers/llm/grok.provider.js';
import { createEgressProvider } from './providers/media/egress.provider.js';
import { createLiveKitProvider, createLiveKitWebhookVerifier } from './providers/media/livekit.provider.js';
import { createR2Storage } from './providers/object-storage/r2.provider.js';
import { createEventHub } from './realtime/eventHub.js';
import { createPrisma } from './repositories/prisma.js';

/** Real providers from configuration; each is null when its settings are missing. */
export function createDeps(env: Env): AppDeps {
  const db = createPrisma(env.DATABASE_URL);
  return {
    env,
    db,
    crypto: createCrypto(env.SESSION_SECRET),
    media: createLiveKitProvider(env),
    egress: createEgressProvider(env),
    storage: createR2Storage(env),
    webhooks: createLiveKitWebhookVerifier(env),
    documents: createDocumentServiceClient(env),
    llm: createGrokProvider(env),
    events: createEventHub(db),
    now: () => new Date(),
  };
}
