import { useState } from 'react';
import { Camera, EyeOff, MonitorX, Smartphone, UserX, Users, Volume2, Info } from 'lucide-react';
import type { ProctoringEvent, ProctoringEventType, ProctoringReviewStatus, ReviewProctoringEventRequest } from '@/api/client';
import { Button } from '@/components/Button';
import { StatusBadge, type Tone } from '@/components/StatusBadge';
import { formatClock, formatDuration, formatTime } from '@/utils/format';

const typeMeta: Record<ProctoringEventType, { label: string; icon: typeof Camera }> = {
  FACE_ABSENT: { label: 'Face not visible', icon: UserX },
  MULTIPLE_FACES: { label: 'More than one face', icon: Users },
  LOOKING_AWAY: { label: 'Looking away', icon: EyeOff },
  TAB_HIDDEN: { label: 'Interview tab hidden', icon: MonitorX },
  SECONDARY_CONNECTED: { label: 'Phone camera connected', icon: Smartphone },
  SECONDARY_DISCONNECTED: { label: 'Phone camera disconnected', icon: Smartphone },
  AUDIO_ISSUE: { label: 'Audio issue', icon: Volume2 },
};

const reviewMeta: Record<ProctoringReviewStatus, { label: string; tone: Tone }> = {
  UNREVIEWED: { label: 'Not reviewed', tone: 'neutral' },
  NO_CONCERN: { label: 'No concern', tone: 'success' },
  NEEDS_FOLLOW_UP: { label: 'Needs follow-up', tone: 'warning' },
};

export interface ProctoringTimelineProps {
  events: ProctoringEvent[];
  /** Interview start, used to show "mm:ss into the interview". */
  startedAt: string | null;
  /** Provide to let the recruiter review events (report page). Omit for read-only (live monitor). */
  onReview?: (eventId: string, body: ReviewProctoringEventRequest) => Promise<void>;
  emptyMessage?: string;
}

/** Timestamped observations for human review. Never presented as proof of cheating (PRD §13). */
export function ProctoringTimeline({ events, startedAt, onReview, emptyMessage = 'No observations were logged.' }: ProctoringTimelineProps) {
  const sorted = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return (
    <div>
      <p className="mb-4 flex items-start gap-2 rounded bg-info-soft px-3 py-2 text-xs text-info">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="text-ink-muted">
          These are automated observations for a reviewer to look at in context. They are not evidence of cheating and are never used to
          reject a candidate automatically.
        </span>
      </p>
      {sorted.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">{emptyMessage}</p>
      ) : (
        <ol className="relative space-y-4 border-l border-line pl-6">
          {sorted.map((event) => (
            <TimelineItem key={event.id} event={event} startedAt={startedAt} onReview={onReview} />
          ))}
        </ol>
      )}
    </div>
  );
}

function TimelineItem({
  event,
  startedAt,
  onReview,
}: {
  event: ProctoringEvent;
  startedAt: string | null;
  onReview?: ProctoringTimelineProps['onReview'];
}) {
  const meta = typeMeta[event.type] ?? { label: event.type, icon: Camera };
  const Icon = meta.icon;
  const review = reviewMeta[event.reviewStatus];
  const offset = startedAt ? (new Date(event.occurredAt).getTime() - new Date(startedAt).getTime()) / 1000 : null;

  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<ProctoringReviewStatus>(event.reviewStatus);
  const [note, setNote] = useState(event.reviewerNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!onReview) return;
    setSaving(true);
    setError(null);
    try {
      await onReview(event.id, { reviewStatus: status, reviewerNote: note.trim() || undefined });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the review.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="relative">
      <span className="absolute -left-[37px] flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-ink-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-ink">{meta.label}</p>
        <StatusBadge tone={review.tone}>{review.label}</StatusBadge>
      </div>
      <p className="mt-0.5 text-xs text-ink-subtle">
        {offset !== null && offset >= 0 ? `${formatClock(offset)} into interview · ` : ''}
        {formatTime(event.occurredAt)} · {event.sourceCamera === 'PRIMARY' ? 'Laptop camera' : 'Phone camera'}
        {event.durationSeconds !== null ? ` · lasted ${formatDuration(event.durationSeconds)}` : ''}
      </p>
      <p className="mt-1 text-sm text-ink-muted">{event.description}</p>
      {event.reviewerNote && !editing && (
        <p className="mt-1.5 rounded bg-surface-muted px-3 py-2 text-sm text-ink">
          <span className="font-medium">Reviewer note:</span> {event.reviewerNote}
        </p>
      )}

      {onReview && !editing && (
        <button type="button" onClick={() => setEditing(true)} className="no-print mt-1.5 text-xs font-medium text-brand hover:underline">
          {event.reviewStatus === 'UNREVIEWED' ? 'Review' : 'Edit review'}
        </button>
      )}

      {onReview && editing && (
        <div className="no-print mt-2 space-y-2 rounded border border-line p-3">
          <fieldset>
            <legend className="text-xs font-medium text-ink">Your review</legend>
            <div className="mt-1.5 flex flex-wrap gap-3 text-sm">
              {(['NO_CONCERN', 'NEEDS_FOLLOW_UP', 'UNREVIEWED'] as const).map((value) => (
                <label key={value} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`review-${event.id}`}
                    value={value}
                    checked={status === value}
                    onChange={() => setStatus(value)}
                    className="accent-[rgb(var(--hb-brand))]"
                  />
                  {reviewMeta[value].label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-xs font-medium text-ink" htmlFor={`note-${event.id}`}>
            Note (optional)
          </label>
          <textarea
            id={`note-${event.id}`}
            className="input min-h-[60px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} loading={saving}>
              Save review
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
