import type { Prisma, RecordingStatus } from '../generated/prisma/client.js';
import type { DbOrTx } from './prisma.js';

export function findRecordingWithInterview(db: DbOrTx, id: string) {
  return db.recording.findUnique({ where: { id }, include: { interview: { select: { id: true, recruiterId: true } } } });
}

export function findActiveRecording(db: DbOrTx, interviewId: string, statuses: readonly RecordingStatus[]) {
  return db.recording.findFirst({ where: { interviewId, status: { in: [...statuses] } }, orderBy: { createdAt: 'desc' } });
}

/** Conditional update: only applies if the row is still in `from` (guards against out-of-order events). */
export async function transitionRecording(
  db: DbOrTx,
  id: string,
  from: RecordingStatus,
  data: Prisma.RecordingUpdateManyMutationInput & { status: RecordingStatus },
): Promise<boolean> {
  const { count } = await db.recording.updateMany({ where: { id, status: from }, data });
  return count > 0;
}
