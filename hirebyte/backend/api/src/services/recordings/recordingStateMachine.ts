import type { RecordingStatus } from '../../generated/prisma/client.js';
import type { EgressState } from '../../providers/media/livekit.provider.js';

/**
 * Recording lifecycle (PRD §4.1). Status must reflect real provider state: a recording only becomes
 * READY after the file is confirmed in storage, and never moves backwards on late/duplicate events.
 */
const transitions: Record<RecordingStatus, RecordingStatus[]> = {
  NOT_ENABLED: [],
  PENDING: ['RECORDING', 'FINALIZING', 'FAILED'],
  RECORDING: ['FINALIZING', 'FAILED'],
  FINALIZING: ['READY', 'FAILED'],
  READY: ['DELETED'],
  FAILED: ['DELETED'],
  DELETED: [],
};

export function canTransitionRecording(from: RecordingStatus, to: RecordingStatus): boolean {
  return transitions[from].includes(to);
}

export const ACTIVE_RECORDING_STATUSES: readonly RecordingStatus[] = ['PENDING', 'RECORDING', 'FINALIZING'];

/**
 * Status implied by an egress state. COMPLETE maps to FINALIZING: READY is only set after the object
 * is confirmed to exist in R2.
 */
export function statusForEgress(state: EgressState): RecordingStatus | null {
  switch (state) {
    case 'STARTING':
      return null;
    case 'ACTIVE':
      return 'RECORDING';
    case 'ENDING':
    case 'COMPLETE':
      return 'FINALIZING';
    case 'FAILED':
    case 'ABORTED':
    case 'LIMIT_REACHED':
      return 'FAILED';
  }
}
