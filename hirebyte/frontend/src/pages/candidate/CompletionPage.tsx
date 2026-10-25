import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, LogOut } from 'lucide-react';
import { api } from '@/api/client';
import { useAsync } from '@/api/client/useAsync';
import { useCandidateOutlet } from '@/app/CandidateRouteGuard';
import { useCandidateSession } from '@/features/auth';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Spinner } from '@/components/PageState';
import { createBrowserTts } from '@/features/voice/ttsAdapter';

/** Thank-you screen. Shows submission status only — never scores or reviewer data (PRD §7.1). */
export function CompletionPage() {
  const { session } = useCandidateOutlet();
  const { signOut } = useCandidateSession();
  const navigate = useNavigate();
  const endedByFullscreen = (useLocation().state as { endedBy?: string } | null)?.endedBy === 'fullscreen';
  const { data, loading, error } = useAsync((signal) => api.candidate.currentQuestion(session.sessionId, signal), [session.sessionId]);
  const conversation = useAsync((signal) => api.candidate.conversation(session.sessionId, signal), [session.sessionId]);
  const closings = conversation.data?.turns.filter((t) => t.kind === 'CLOSING') ?? [];
  const closing = closings[closings.length - 1]?.text ?? null;
  const tts = useMemo(() => createBrowserTts(), []);
  // The interviewer says goodbye once, out loud.
  useEffect(() => {
    if (closing && tts.isSupported) tts.speak(closing);
    return () => tts.stop();
  }, [closing, tts]);

  const onSignOut = async () => {
    await signOut().catch(() => undefined);
    navigate('/candidate/login', { replace: true });
  };

  const progress = data?.progress;
  const unanswered = progress ? progress.total - progress.answered - progress.skipped : 0;

  return (
    <div className="mx-auto max-w-xl">
      <section className="card flex flex-col items-center gap-5 p-8 text-center sm:p-10">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-soft">
          <CheckCircle2 className="h-9 w-9 text-success" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold text-ink">Thank you, {session.candidateName}</h1>
          <p className="mt-2 text-ink-muted">
            Your interview for <span className="font-medium text-ink">{session.jobTitle}</span> has been submitted.
          </p>
          {closing && (
            <p className="mt-3 rounded-lg border border-line px-4 py-3 text-left text-sm text-ink">
              <span className="font-semibold">Interviewer: </span>
              {closing}
            </p>
          )}
        </div>

        {endedByFullscreen && (
          <Alert tone="warning" title="The interview ended when you left full screen" className="w-full text-left">
            The interview must stay in full screen. Your saved answers were submitted.
          </Alert>
        )}

        <div className="w-full rounded-lg bg-surface-muted p-4 text-sm" aria-live="polite">
          {loading ? (
            <Spinner label="Confirming your submission…" />
          ) : error || !progress ? (
            <p className="text-ink-muted">Your answers were saved as you went. We could not load the summary right now, but nothing is lost.</p>
          ) : (
            <dl className="grid grid-cols-3 gap-2">
              <div>
                <dt className="text-xs text-ink-muted">Answered</dt>
                <dd className="text-lg font-semibold text-ink">{progress.answered}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Skipped</dt>
                <dd className="text-lg font-semibold text-ink">{progress.skipped}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Unanswered</dt>
                <dd className="text-lg font-semibold text-ink">{unanswered}</dd>
              </div>
            </dl>
          )}
        </div>

        <div className="space-y-2 text-sm text-ink-muted">
          <p>
            The hiring team at {session.companyName} will review your interview. Any next steps will come from the recruiter
            directly.
          </p>
          <p>You can close this window now.</p>
        </div>

        <Button variant="secondary" onClick={onSignOut} icon={<LogOut className="h-4 w-4" aria-hidden />}>
          Sign out
        </Button>
      </section>
    </div>
  );
}
