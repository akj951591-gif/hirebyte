import type { AuthUser } from '../services/auth/auth.service.js';
import type { CandidateContext } from '../services/auth/candidateSession.service.js';
import type { MediaWebhookEvent } from '../providers/media/livekit.provider.js';

declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: AuthUser;
      candidate?: CandidateContext;
      webhookEvent?: MediaWebhookEvent;
    }
  }
}

export {};
