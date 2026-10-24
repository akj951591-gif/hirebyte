import { logger, safeError } from '../lib/logger.js';
import type { DbOrTx } from './prisma.js';

export interface AuditEntry {
  actorId?: string | null;
  actorRole: 'RECRUITER' | 'ADMIN' | 'CANDIDATE' | 'SYSTEM' | 'ANONYMOUS';
  action: string;
  resourceType: string;
  resourceId?: string | null;
  /** Safe metadata only: never secrets, tokens, codes or signed URLs. */
  metadata?: Record<string, string | number | boolean | null>;
}

/** Audit failures are logged but never break the request that triggered them. */
export async function recordAudit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        actorId: entry.actorId ?? null,
        actorRole: entry.actorRole,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        metadata: entry.metadata ?? undefined,
      },
    });
  } catch (err) {
    logger.warn('audit write failed', { action: entry.action, ...safeError(err) });
  }
}
