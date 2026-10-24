import type { RecordingStatus as RecordingStatusValue } from '@/api/client';
import { StatusBadge, type Tone } from '@/components/StatusBadge';

export const recordingStatusMeta: Record<RecordingStatusValue, { label: string; tone: Tone; live?: boolean; description: string }> = {
  NOT_ENABLED: { label: 'Not recorded', tone: 'neutral', description: 'Recording was not enabled or not consented to for this interview.' },
  PENDING: { label: 'Pending', tone: 'info', live: true, description: 'Waiting for the recording service to confirm the recording has started.' },
  RECORDING: { label: 'Recording', tone: 'danger', live: true, description: 'The interview is being recorded right now.' },
  FINALIZING: {
    label: 'Processing',
    tone: 'warning',
    live: true,
    description: 'The recording is being finalised and uploaded. It becomes watchable once the file is confirmed in storage.',
  },
  READY: { label: 'Ready', tone: 'success', description: 'The recording is stored and can be watched by authorised recruiters.' },
  FAILED: { label: 'Failed', tone: 'danger', description: 'The recording could not be completed. The interview answers are not affected.' },
  DELETED: { label: 'Deleted', tone: 'neutral', description: 'This recording was deleted under the retention policy or by a recruiter.' },
};

export function RecordingStatusBadge({ status }: { status: RecordingStatusValue }) {
  const meta = recordingStatusMeta[status];
  return (
    <StatusBadge tone={meta.tone} live={meta.live}>
      {meta.label}
    </StatusBadge>
  );
}
