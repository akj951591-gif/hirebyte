import type { ReactNode } from 'react';
import { Clock, FileVideo, Loader2, Lock, PlayCircle, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import type { Recording } from '@/api/client';
import { Button } from '@/components/Button';
import { formatBytes, formatDateTime, formatDuration, formatTime } from '@/utils/format';
import { usePlaybackUrl } from './hooks/usePlaybackUrl';
import { RecordingStatusBadge, recordingStatusMeta } from './RecordingStatus';

function Message({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg bg-surface-sunken p-6 text-center">
      <span className="text-ink-subtle">{icon}</span>
      <p className="font-medium text-ink">{title}</p>
      {children && <p className="max-w-md text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * "Watch Recording" for the report page (PRD §7.2). The button only appears when the backend reports
 * READY; every other status is explained instead of showing a player that cannot work.
 */
export function RecordingPlayer({ recording, onRefresh }: { recording: Recording; onRefresh?: () => void }) {
  const { state, request, reportPlaybackFailure } = usePlaybackUrl(recording.id);
  const meta = recordingStatusMeta[recording.status];

  const details = (
    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
      <div className="flex gap-1">
        <dt>Status:</dt>
        <dd>
          <RecordingStatusBadge status={recording.status} />
        </dd>
      </div>
      {recording.durationSeconds !== null && (
        <div className="flex gap-1">
          <dt>Length:</dt>
          <dd>{formatDuration(recording.durationSeconds)}</dd>
        </div>
      )}
      {recording.sizeBytes !== null && (
        <div className="flex gap-1">
          <dt>Size:</dt>
          <dd>{formatBytes(recording.sizeBytes)}</dd>
        </div>
      )}
      {recording.completedAt && (
        <div className="flex gap-1">
          <dt>Finished:</dt>
          <dd>{formatDateTime(recording.completedAt)}</dd>
        </div>
      )}
    </dl>
  );

  if (recording.status !== 'READY') {
    const icon =
      recording.status === 'DELETED' ? (
        <Trash2 className="h-8 w-8" aria-hidden />
      ) : recording.status === 'FAILED' ? (
        <TriangleAlert className="h-8 w-8 text-danger" aria-hidden />
      ) : (
        <Clock className="h-8 w-8" aria-hidden />
      );
    return (
      <div>
        <Message
          icon={icon}
          title={recording.status === 'FAILED' ? 'Recording failed' : `Recording ${meta.label.toLowerCase()}`}
          action={
            onRefresh && ['PENDING', 'RECORDING', 'FINALIZING'].includes(recording.status) ? (
              <Button variant="secondary" size="sm" onClick={onRefresh} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}>
                Check again
              </Button>
            ) : undefined
          }
        >
          {meta.description}
          {recording.failureCode && <span className="mt-1 block font-mono text-xs">Code: {recording.failureCode}</span>}
        </Message>
        {details}
      </div>
    );
  }

  let body: ReactNode;
  switch (state.status) {
    case 'idle':
      body = (
        <Message
          icon={<FileVideo className="h-8 w-8" aria-hidden />}
          title="Recording available"
          action={
            <Button onClick={request} icon={<PlayCircle className="h-4 w-4" aria-hidden />}>
              Watch recording
            </Button>
          }
        >
          A secure, time-limited link is created when you press play.
        </Message>
      );
      break;
    case 'loading':
      body = (
        <Message icon={<Loader2 className="h-8 w-8 animate-spin" aria-hidden />} title="Preparing secure playback…" />
      );
      break;
    case 'ready':
      body = (
        <div>
          <video
            key={state.url}
            src={state.url}
            controls
            preload="metadata"
            className="aspect-video w-full rounded-lg bg-ink"
            onError={reportPlaybackFailure}
            controlsList="nodownload"
          >
            Your browser cannot play this video format.
          </video>
          <p className="mt-1 text-xs text-ink-subtle">Playback link valid until {formatTime(state.expiresAt)}.</p>
        </div>
      );
      break;
    case 'expired':
      body = (
        <Message
          icon={<Clock className="h-8 w-8" aria-hidden />}
          title="Playback link expired"
          action={
            <Button onClick={request} icon={<RefreshCw className="h-4 w-4" aria-hidden />}>
              Get a new link
            </Button>
          }
        >
          For security, playback links only work for a few minutes.
        </Message>
      );
      break;
    case 'error': {
      const { code, message } = state.error;
      const notAllowed = code === 'FORBIDDEN' || code === 'UNAUTHENTICATED';
      const gone = code === 'RECORDING_DELETED' || code === 'NOT_FOUND';
      body = (
        <Message
          icon={notAllowed ? <Lock className="h-8 w-8" aria-hidden /> : gone ? <Trash2 className="h-8 w-8" aria-hidden /> : <TriangleAlert className="h-8 w-8 text-danger" aria-hidden />}
          title={
            notAllowed
              ? 'You are not authorised to watch this recording'
              : gone
                ? 'Recording file is missing or deleted'
                : code === 'RECORDING_NOT_READY'
                  ? 'Recording not ready yet'
                  : 'Recording unavailable'
          }
          action={
            !notAllowed && !gone ? (
              <Button variant="secondary" onClick={request} icon={<RefreshCw className="h-4 w-4" aria-hidden />}>
                Try again
              </Button>
            ) : undefined
          }
        >
          {message}
        </Message>
      );
      break;
    }
  }

  return (
    <div>
      {body}
      {details}
    </div>
  );
}
