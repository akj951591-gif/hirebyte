import { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, MonitorSmartphone, Video } from 'lucide-react';
import { api, type MediaConnectionStatus } from '@/api/client';
import { useAsync, usePolling } from '@/api/client/useAsync';
import { PageHeader } from '@/app/RecruiterLayout';
import { CancelInterviewButton, InterviewStatusBadge } from '@/features/interviews';
import { useWatchRoom } from '@/features/media';
import { ProctoringTimeline } from '@/features/proctoring';
import { RecordingStatusBadge } from '@/features/recordings';
import { Alert } from '@/components/Alert';
import { buttonClasses } from '@/components/Button';
import { ErrorState, LoadingState } from '@/components/PageState';
import { QuestionCard } from '@/components/QuestionCard';
import { ReportSection } from '@/components/ReportSection';
import { StatusBadge, type Tone } from '@/components/StatusBadge';
import { VideoPanel } from '@/components/VideoPanel';
import { appConfig } from '@/config/app.config';
import { formatClock, formatTime, humanize } from '@/utils/format';

const connectionMeta: Record<MediaConnectionStatus, { label: string; tone: Tone; live?: boolean }> = {
  NOT_CONNECTED: { label: 'Not connected', tone: 'neutral' },
  CONNECTING: { label: 'Connecting', tone: 'info', live: true },
  CONNECTED: { label: 'Connected', tone: 'success', live: true },
  DISCONNECTED: { label: 'Disconnected', tone: 'warning' },
};

const LIVE = ['ONBOARDING', 'IN_PROGRESS', 'PROCESSING_ANSWER'];

/**
 * Live monitor (PRD §7.2). Status, progress and observations are polled from the API. Video comes
 * from LiveKit: the recruiter joins hidden and subscribe-only, so the candidate is not affected.
 */
export function MonitorPage() {
  const { id = '' } = useParams();
  const { data: interview, error, loading, reload } = useAsync((signal) => api.interviews.get(id, signal), [id]);
  const isLive = interview ? LIVE.includes(interview.status) : false;
  usePolling(() => void reload({ silent: true }), appConfig.monitorPollMs, isLive);
  const getViewerToken = useCallback(() => api.media.token(id, { device: 'viewer' }), [id]);
  const watch = useWatchRoom({ getToken: getViewerToken, enabled: isLive });

  if (loading && !interview) return <LoadingState label="Connecting to the interview…" />;
  if (error || !interview) {
    return (
      <div className="card">
        <ErrorState message={error?.message ?? 'Could not load the interview.'} code={error?.code} requestId={error?.requestId} onRetry={() => void reload()} />
      </div>
    );
  }

  const live = interview.live;
  const progress = live?.progress;
  const currentQuestion = progress?.currentSequence ? interview.questions.find((q) => q.sequence === progress.currentSequence) : undefined;
  const elapsed = interview.startedAt ? (Date.now() - new Date(interview.startedAt).getTime()) / 1000 : null;
  const done = progress ? progress.answered + progress.skipped : 0;
  const percent = progress?.total ? Math.round((done / progress.total) * 100) : 0;

  const tileStatus = (status: MediaConnectionStatus | undefined) => {
    const meta = connectionMeta[status ?? 'NOT_CONNECTED'];
    return (
      <StatusBadge tone={meta.tone} live={meta.live}>
        {meta.label}
      </StatusBadge>
    );
  };
  const tilePlaceholder = (label: string) => (
    <>
      <Video className="h-6 w-6" aria-hidden />
      <span className="max-w-xs">
        {!isLive
          ? 'Video is shown while the interview is running.'
          : watch.status === 'unavailable'
            ? 'Live video is not set up on this server (LiveKit).'
            : watch.status === 'error'
              ? (watch.error ?? 'Live video could not connect.')
              : watch.status === 'connected'
                ? `Waiting for the candidate’s ${label.toLowerCase()}…`
                : 'Connecting to live video…'}
      </span>
    </>
  );

  return (
    <>
      <Link to="/recruiter/interviews" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Interviews
      </Link>
      <PageHeader
        title={`${interview.candidateName} · ${interview.jobTitle}`}
        description={
          interview.startedAt
            ? `Started ${formatTime(interview.startedAt)}${elapsed !== null && isLive ? ` · ${formatClock(elapsed)} elapsed` : ''}`
            : 'Not started yet'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <InterviewStatusBadge status={interview.status} />
            <RecordingStatusBadge status={interview.recordingStatus} />
            <CancelInterviewButton interview={interview} onCancelled={() => void reload({ silent: true })} />
          </div>
        }
      />

      {!isLive && (
        <Alert
          tone="info"
          className="mb-6"
          title="This interview is not live"
          action={
            ['COMPLETED', 'EVALUATING', 'EVALUATED', 'EVALUATION_FAILED', 'REVIEWED'].includes(interview.status) ? (
              <Link to={`/recruiter/interviews/${interview.id}/report`} className={buttonClasses('secondary', 'sm')}>
                <FileText className="h-3.5 w-3.5" aria-hidden />
                Open report
              </Link>
            ) : undefined
          }
        >
          {interview.status === 'READY' || interview.status === 'DRAFT'
            ? 'The candidate has not joined yet. This page updates automatically once they start.'
            : 'The interview has ended.'}
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <VideoPanel label="Laptop camera" stream={watch.laptop} muted={false} status={tileStatus(live?.primaryCamera)} placeholder={tilePlaceholder('Laptop camera')} />
            {interview.config.secondaryCamera === 'OFF' ? (
              <VideoPanel
                label="Phone camera"
                placeholder={
                  <>
                    <MonitorSmartphone className="h-6 w-6" aria-hidden />
                    <span>Phone camera is turned off for this interview.</span>
                  </>
                }
              />
            ) : (
              <VideoPanel label="Phone camera" stream={watch.phone} status={tileStatus(live?.secondaryCamera)} placeholder={tilePlaceholder('Phone camera')} />
            )}
          </div>

          <ReportSection
            title="Question progress"
            description={live ? `Updated ${formatTime(live.updatedAt)} · refreshes every ${appConfig.monitorPollMs / 1000}s` : undefined}
          >
            {progress ? (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-muted">
                      {progress.answered} answered · {progress.skipped} skipped · {progress.total - done} remaining
                    </span>
                    <span className="font-medium text-ink">{percent}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Interview progress">
                    <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${percent}%` }} />
                  </div>
                </div>
                {currentQuestion ? (
                  <QuestionCard
                    sequence={currentQuestion.sequence}
                    total={progress.total}
                    text={currentQuestion.text}
                    tags={['Current question', humanize(currentQuestion.category)]}
                  />
                ) : (
                  <p className="text-sm text-ink-muted">All questions have been answered or skipped.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-ink-muted">Progress appears here once the interview is in progress.</p>
            )}
          </ReportSection>
        </div>

        <ReportSection title="Observations" description="Live, timestamped events.">
          <ProctoringTimeline
            events={live?.recentEvents ?? []}
            startedAt={interview.startedAt}
            emptyMessage={isLive ? 'No observations so far.' : 'No live observations. See the report for the full timeline.'}
          />
        </ReportSection>
      </div>
    </>
  );
}
