import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, CheckCircle2, Mic, PlayCircle, RefreshCw, Volume2, XCircle, AlertTriangle, Keyboard } from 'lucide-react';
import { api } from '@/api/client';
import { toApiError, usePolling } from '@/api/client/useAsync';
import { useCandidateOutlet } from '@/app/CandidateRouteGuard';
import { PhonePairingQR, useLocalMedia } from '@/features/media';
import { createBrowserStt, createBrowserTts } from '@/features/voice';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { VideoPanel } from '@/components/VideoPanel';
import { Spinner } from '@/components/PageState';
import { cn } from '@/components/cn';
import { appConfig } from '@/config/app.config';
import { featureFlags } from '@/config/featureFlags';

type CheckStatus = 'ok' | 'warn' | 'fail' | 'pending';

function CheckRow({ icon, label, status, children }: { icon: ReactNode; label: string; status: CheckStatus; children: ReactNode }) {
  const statusIcon = {
    ok: <CheckCircle2 className="h-5 w-5 text-success" aria-label="Passed" />,
    warn: <AlertTriangle className="h-5 w-5 text-warning" aria-label="Limited" />,
    fail: <XCircle className="h-5 w-5 text-danger" aria-label="Failed" />,
    pending: <Spinner label="" className="h-5 w-5" />,
  }[status];
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-ink">{label}</p>
          {statusIcon}
        </div>
        <div className="mt-0.5 text-sm text-ink-muted">{children}</div>
      </div>
    </li>
  );
}

export function DeviceCheckPage() {
  const { session, setSession, reloadSession } = useCandidateOutlet();
  const navigate = useNavigate();
  const media = useLocalMedia({ autoStart: true });
  const tts = useMemo(() => createBrowserTts(), []);
  const sttSupported = useMemo(() => createBrowserStt().isSupported, []);
  const [heardTest, setHeardTest] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<{ code: string; message: string } | null>(null);

  const policy = session.secondaryCamera;
  const pairingStatus = session.pairing?.status;
  usePolling(() => void reloadSession(), appConfig.pairingPollMs, policy !== 'OFF' && pairingStatus !== 'PAIRED');

  const cameraStatus: CheckStatus =
    media.state === 'ready' && media.hasVideo ? 'ok' : media.state === 'requesting' || media.state === 'idle' ? 'pending' : 'fail';
  const micStatus: CheckStatus =
    media.state === 'ready' && media.hasAudio ? 'ok' : media.state === 'requesting' || media.state === 'idle' ? 'pending' : 'fail';
  const phoneBlocks = policy === 'REQUIRED' && pairingStatus !== 'PAIRED';
  const canStart = cameraStatus === 'ok' && micStatus === 'ok' && !phoneBlocks;

  const playTest = () => {
    tts.speak('This is how your interview questions will sound.', { onEnd: () => setHeardTest(true) });
  };

  const onStart = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const current = await api.candidate.start(session.sessionId);
      media.stop();
      setSession((s) => ({ ...s, status: current.status }));
      navigate('/candidate/interview', { replace: true });
    } catch (err) {
      const error = toApiError(err);
      setStartError({ code: error.code, message: error.message });
      setStarting(false);
    }
  };

  const simulatePhone = async (paired: boolean) => {
    if (import.meta.env.VITE_USE_FIXTURES !== 'true') return; // lets the bundler drop the fixture chunk
    const { fixtureControls } = await import('@/api/client/mockTransport');
    fixtureControls.setPhonePaired(session.sessionId, paired);
    await reloadSession();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Check your camera and microphone</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Make sure you can see yourself and the microphone meter moves when you speak.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <VideoPanel
            label="Your camera"
            stream={media.stream}
            mirrored
            status={
              media.state === 'ready' ? (
                <StatusBadge tone="success" live>
                  Camera on
                </StatusBadge>
              ) : undefined
            }
            placeholder={
              media.state === 'requesting' || media.state === 'idle' ? (
                <span>Waiting for camera permission…</span>
              ) : (
                <span className="max-w-sm">{media.errorMessage}</span>
              )
            }
          />
          {media.errorMessage && (
            <Alert
              tone="danger"
              title="Camera or microphone unavailable"
              action={
                <Button variant="secondary" size="sm" onClick={() => void media.start()} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}>
                  Try again
                </Button>
              }
            >
              {media.errorMessage}
            </Alert>
          )}

          {policy !== 'OFF' && (
            <section className="card p-5" aria-label="Phone camera">
              <PhonePairingQR pairing={session.pairing} policy={policy} />
              {featureFlags.useFixtures && session.pairing && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-dashed border-warning/50 pt-3 text-xs text-ink-muted">
                  <span>Fixture only:</span>
                  <Button size="sm" variant="secondary" onClick={() => void simulatePhone(pairingStatus !== 'PAIRED')}>
                    {pairingStatus === 'PAIRED' ? 'Simulate phone disconnect' : 'Simulate phone connected'}
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <section className="card px-5 py-2" aria-label="Device checks">
            <ul className="divide-y divide-line">
              <CheckRow icon={<Camera className="h-4 w-4" aria-hidden />} label="Camera" status={cameraStatus}>
                {cameraStatus === 'ok' ? 'Working' : cameraStatus === 'pending' ? 'Checking…' : 'Not available'}
              </CheckRow>
              <CheckRow icon={<Mic className="h-4 w-4" aria-hidden />} label="Microphone" status={micStatus}>
                {micStatus === 'ok' ? (
                  <div className="mt-1.5">
                    <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                      <div
                        className={cn('h-full rounded-full transition-[width] duration-100', media.audioLevel > 0.08 ? 'bg-success' : 'bg-ink-subtle')}
                        style={{ width: `${Math.round(media.audioLevel * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs">Say a few words — the bar should move.</p>
                  </div>
                ) : micStatus === 'pending' ? (
                  'Checking…'
                ) : (
                  'Not available'
                )}
              </CheckRow>
              <CheckRow
                icon={<Volume2 className="h-4 w-4" aria-hidden />}
                label="Speakers"
                status={!tts.isSupported ? 'warn' : heardTest ? 'ok' : 'warn'}
              >
                {tts.isSupported ? (
                  <button type="button" onClick={playTest} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                    <PlayCircle className="h-4 w-4" aria-hidden />
                    {heardTest ? 'Play again' : 'Play a test question'}
                  </button>
                ) : (
                  'Questions will be shown as text only in this browser.'
                )}
              </CheckRow>
              <CheckRow
                icon={<Keyboard className="h-4 w-4" aria-hidden />}
                label="Voice answers"
                status={sttSupported ? 'ok' : 'warn'}
              >
                {sttSupported
                  ? 'Speech recognition is available. You can also type answers.'
                  : 'Speech recognition is not supported in this browser, so you will type your answers. Chrome or Edge support voice answers.'}
              </CheckRow>
            </ul>
          </section>

          {startError && (
            <Alert tone="danger" title="Could not start the interview">
              {startError.message}
              {startError.code === 'CONSENT_REQUIRED' && (
                <Link to="/candidate/lobby" className="mt-1 block font-medium underline">
                  Review the notice
                </Link>
              )}
            </Alert>
          )}

          <Button size="lg" className="w-full" disabled={!canStart} loading={starting} onClick={onStart}>
            Start interview
          </Button>
          {!canStart && !starting && (
            <p className="text-center text-xs text-ink-muted" role="status">
              {phoneBlocks ? 'Connect your phone camera to continue.' : 'Your camera and microphone need to work before you start.'}
            </p>
          )}
          <Link to="/candidate/lobby" className="flex items-center justify-center gap-1 text-sm text-ink-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to instructions
          </Link>
        </aside>
      </div>
    </div>
  );
}
