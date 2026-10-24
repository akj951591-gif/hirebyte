import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Clock, Eye, ListOrdered, Video, VideoOff } from 'lucide-react';
import { api } from '@/api/client';
import { toApiError } from '@/api/client/useAsync';
import { useCandidateOutlet } from '@/app/CandidateRouteGuard';
import { useCandidateSession } from '@/features/auth';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';

export function LobbyPage() {
  const { session, setSession } = useCandidateOutlet();
  const { signOut } = useCandidateSession();
  const navigate = useNavigate();
  const { recording, proctoring } = session;

  const [recordingConsent, setRecordingConsent] = useState(session.consent?.recordingConsent ?? false);
  const [proctoringConsent, setProctoringConsent] = useState(session.consent?.proctoringConsent ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recordingBlocks = recording.enabled && recording.required && !recordingConsent;
  const proctoringBlocks = proctoring.enabled && !proctoringConsent;
  const canContinue = !recordingBlocks && !proctoringBlocks;

  const onContinue = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { consent } = await api.candidate.consent(session.sessionId, {
        recordingNoticeVersion: recording.noticeVersion,
        proctoringNoticeVersion: proctoring.noticeVersion,
        recordingConsent: recording.enabled && recordingConsent,
        proctoringConsent,
      });
      setSession((s) => ({ ...s, consent }));
      navigate('/candidate/device-check');
    } catch (err) {
      const apiError = toApiError(err);
      setError(apiError.message);
      setSubmitting(false);
    }
  };

  const onSignOut = async () => {
    await signOut().catch(() => undefined);
    navigate('/candidate/login', { replace: true });
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <section className="card p-6">
          <p className="text-sm font-medium text-brand">Welcome, {session.candidateName}</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">{session.jobTitle} interview</h1>
          <p className="mt-1 text-sm text-ink-muted">with {session.companyName}</p>
          <dl className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div className="flex items-center gap-2.5 rounded bg-surface-muted px-3 py-2.5">
              <Clock className="h-4 w-4 text-brand" aria-hidden />
              <dt className="text-ink-muted">About</dt>
              <dd className="font-medium text-ink">{session.estimatedDurationMinutes} minutes</dd>
            </div>
            <div className="flex items-center gap-2.5 rounded bg-surface-muted px-3 py-2.5">
              <ListOrdered className="h-4 w-4 text-brand" aria-hidden />
              <dt className="text-ink-muted">Questions</dt>
              <dd className="font-medium text-ink">{session.questionCount}</dd>
            </div>
          </dl>
        </section>

        <section className="card p-6" aria-labelledby="instructions-heading">
          <h2 id="instructions-heading" className="text-base font-semibold text-ink">
            Before you begin
          </h2>
          <ol className="mt-4 space-y-3">
            {session.instructions.map((line, i) => (
              <li key={line} className="flex gap-3 text-sm text-ink-muted">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-strong">
                  {i + 1}
                </span>
                <span className="pt-0.5">{line}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="card p-5" aria-labelledby="recording-heading">
          <div className="flex items-center gap-2">
            {recording.enabled ? <Video className="h-5 w-5 text-brand" aria-hidden /> : <VideoOff className="h-5 w-5 text-ink-subtle" aria-hidden />}
            <h2 id="recording-heading" className="font-semibold text-ink">
              Recording
            </h2>
          </div>
          {recording.enabled ? (
            <>
              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="font-medium text-ink">What is recorded</dt>
                  <dd className="text-ink-muted">{recording.feeds.join(', ')}</dd>
                </div>
                <div>
                  <dt className="font-medium text-ink">Why</dt>
                  <dd className="text-ink-muted">{recording.purpose}</dd>
                </div>
                <div>
                  <dt className="font-medium text-ink">Who can watch it</dt>
                  <dd className="text-ink-muted">{recording.access}</dd>
                </div>
                <div>
                  <dt className="font-medium text-ink">How long it is kept</dt>
                  <dd className="text-ink-muted">{recording.retention}</dd>
                </div>
              </dl>
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded border border-line p-3 text-sm hover:bg-surface-muted">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[rgb(var(--hb-brand))]"
                  checked={recordingConsent}
                  onChange={(e) => setRecordingConsent(e.target.checked)}
                />
                <span className="text-ink">I agree to this interview being recorded as described above.</span>
              </label>
              <p className="mt-2 text-xs text-ink-muted">
                {recording.required
                  ? 'Recording is a condition of this interview. If you do not agree, please contact the recruiter about alternatives.'
                  : 'Optional. If you do not agree, the interview continues without a recording.'}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">This interview is not recorded.</p>
          )}
        </section>

        {proctoring.enabled && (
          <section className="card p-5" aria-labelledby="proctoring-heading">
            <div className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-brand" aria-hidden />
              <h2 id="proctoring-heading" className="font-semibold text-ink">
                Observation notice
              </h2>
            </div>
            <p className="mt-2 text-sm text-ink-muted">{proctoring.description}</p>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded border border-line p-3 text-sm hover:bg-surface-muted">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[rgb(var(--hb-brand))]"
                checked={proctoringConsent}
                onChange={(e) => setProctoringConsent(e.target.checked)}
              />
              <span className="text-ink">I understand and agree to my camera and microphone being used for these observations.</span>
            </label>
          </section>
        )}

        {error && <Alert tone="danger">{error}</Alert>}

        <Button size="lg" className="w-full" disabled={!canContinue} loading={submitting} onClick={onContinue}>
          Continue to device check
          {!submitting && <ArrowRight className="h-4 w-4" aria-hidden />}
        </Button>
        {!canContinue && (
          <p className="text-center text-xs text-ink-muted" role="status">
            {proctoringBlocks ? 'Please review and accept the observation notice to continue.' : 'Recording consent is required for this interview.'}
          </p>
        )}
        <button type="button" onClick={onSignOut} className="w-full text-center text-sm text-ink-muted hover:text-ink hover:underline">
          Not you? Sign out
        </button>
      </aside>
    </div>
  );
}
