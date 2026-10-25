import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, SwitchCamera } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { toApiError } from '@/api/client/useAsync';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Logo } from '@/components/Logo';
import { StatusBadge, type Tone } from '@/components/StatusBadge';
import { VideoPanel } from '@/components/VideoPanel';
import { usePublishToRoom, type RoomStatus } from '@/features/media/useLiveKitRoom';
import { useCameraObservations } from '@/features/proctoring';

/** Survives a reload of this tab only; a new QR scan replaces it (PRD §9.1). */
const deviceKey = (interviewId: string) => `hb_phone_device_${interviewId}`;
const readDeviceToken = (interviewId: string) => {
  try {
    return sessionStorage.getItem(deviceKey(interviewId));
  } catch {
    return null;
  }
};
const storeDeviceToken = (interviewId: string, token: string) => {
  try {
    sessionStorage.setItem(deviceKey(interviewId), token);
  } catch {
    // Private mode: the phone will need the QR code again after a reload.
  }
};

const statusMeta: Record<RoomStatus, { label: string; tone: Tone; live?: boolean }> = {
  idle: { label: 'Starting', tone: 'neutral' },
  connecting: { label: 'Connecting', tone: 'info', live: true },
  connected: { label: 'Live', tone: 'danger', live: true },
  reconnecting: { label: 'Reconnecting', tone: 'warning', live: true },
  unavailable: { label: 'Not available', tone: 'neutral' },
  error: { label: 'Not connected', tone: 'warning' },
};

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'Camera access was blocked. Allow the camera for this site in your browser settings, then tap Try again.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close that app, then tap Try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  return 'The camera could not be started. Tap Try again.';
}

/**
 * The candidate's phone, opened from the QR code on the laptop's device check (PRD §9.1). It joins
 * the interview room as a camera-only secondary feed and reports "more than one person" observations.
 */
export function PhoneCameraPage() {
  const [params] = useSearchParams();
  const interviewId = params.get('interview') ?? '';
  const pairingRef = useRef(params.get('token'));
  const deviceTokenRef = useRef<string | null>(readDeviceToken(interviewId));
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The pairing token is single use: keep it out of the address bar, history and screenshots.
  useEffect(() => {
    if (pairingRef.current) window.history.replaceState(null, '', `/pair?interview=${encodeURIComponent(interviewId)}`);
  }, [interviewId]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setCameraError('This page needs a secure (https://) connection to use the camera.');
      return;
    }
    let current: MediaStream | null = null;
    let cancelled = false;
    setCameraError(null);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((media) => {
        if (cancelled) return media.getTracks().forEach((t) => t.stop());
        current = media;
        setStream(media);
      })
      .catch((err) => !cancelled && setCameraError(cameraErrorMessage(err)));
    return () => {
      cancelled = true;
      current?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [facing, attempt]);

  // Keep the screen on while the camera is live, where the browser allows it.
  useEffect(() => {
    if (!stream || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      if (document.visibilityState === 'visible') void navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => undefined);
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => undefined);
    };
  }, [stream]);

  /** Device token first (after a reload); otherwise the one-time pairing token from the QR code. */
  const getToken = useCallback(async () => {
    if (deviceTokenRef.current) {
      try {
        return await api.media.token(interviewId, { device: 'secondary', deviceToken: deviceTokenRef.current });
      } catch (err) {
        if (toApiError(err).code !== 'UNAUTHENTICATED' || !pairingRef.current) throw err;
      }
    }
    if (!pairingRef.current) throw new ApiError('UNAUTHENTICATED', 'Scan the QR code on your laptop to connect this phone.', 401);
    const res = await api.media.token(interviewId, { device: 'secondary', pairingToken: pairingRef.current });
    pairingRef.current = null;
    if (res.deviceToken) {
      deviceTokenRef.current = res.deviceToken;
      storeDeviceToken(interviewId, res.deviceToken);
    }
    return res;
  }, [interviewId]);

  const room = usePublishToRoom({ getToken, stream, enabled: Boolean(interviewId && stream) });
  const reportObservation = useCallback(
    (body: Parameters<typeof api.proctoring.log>[1]) => api.proctoring.logFromPhone(interviewId, { ...body, deviceToken: deviceTokenRef.current ?? '' }),
    [interviewId],
  );
  useCameraObservations({ stream, enabled: room.status === 'connected', camera: 'SECONDARY', report: reportObservation });

  const meta = statusMeta[room.status];
  const problem = !interviewId ? 'This link is incomplete. Scan the QR code on your laptop again.' : (cameraError ?? room.error);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-6">
      <Logo />
      <div>
        <h1 className="text-xl font-semibold text-ink">Phone camera</h1>
        <p className="mt-1 text-sm text-ink-muted">Place your phone to the side so it shows you and your desk. Keep this page open during the interview.</p>
      </div>

      <VideoPanel
        label="Phone camera"
        stream={stream}
        mirrored={facing === 'user'}
        status={
          stream ? (
            <StatusBadge tone={meta.tone} live={meta.live}>
              {meta.label}
            </StatusBadge>
          ) : undefined
        }
      />

      {problem ? (
        <Alert tone="warning" action={<Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />} onClick={() => (cameraError ? setAttempt((a) => a + 1) : window.location.reload())}>Try again</Button>}>
          {problem}
        </Alert>
      ) : room.status === 'unavailable' ? (
        <Alert tone="info">Live video is not set up on this server yet, so the phone camera cannot be used.</Alert>
      ) : room.status === 'connected' ? (
        <Alert tone="success">Your phone camera is connected. You can continue on your laptop.</Alert>
      ) : null}

      <Button variant="secondary" icon={<SwitchCamera className="h-4 w-4" aria-hidden />} onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))} disabled={!stream}>
        Switch to {facing === 'environment' ? 'front' : 'back'} camera
      </Button>
      <p className="text-xs text-ink-muted">
        The video goes only to this interview. Automated checks note things like a second person in view for a human reviewer; they never decide anything on their own.
      </p>
    </main>
  );
}
