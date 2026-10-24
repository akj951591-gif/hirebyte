import { useCallback, useEffect, useRef, useState } from 'react';

export type LocalMediaState = 'idle' | 'requesting' | 'ready' | 'denied' | 'not-found' | 'in-use' | 'unsupported' | 'ended' | 'error';

export interface LocalMedia {
  state: LocalMediaState;
  stream: MediaStream | null;
  hasVideo: boolean;
  hasAudio: boolean;
  /** 0..1 microphone input level, updated ~10x per second while the stream is live. */
  audioLevel: number;
  errorMessage: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

const messages: Record<Exclude<LocalMediaState, 'idle' | 'requesting' | 'ready'>, string> = {
  denied: 'Camera or microphone access was blocked. Allow access in your browser’s site settings, then try again.',
  'not-found': 'No camera or microphone was found. Connect one and try again.',
  'in-use': 'Your camera or microphone is being used by another app. Close other video apps and try again.',
  unsupported: 'This browser cannot access a camera here. Use a recent Chrome, Edge or Safari over HTTPS.',
  ended: 'Your camera or microphone stopped. Reconnect it and try again.',
  error: 'We could not start your camera and microphone. Try again or use another browser.',
};

function classify(error: unknown): Exclude<LocalMediaState, 'idle' | 'requesting' | 'ready' | 'ended'> {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'not-found';
  if (name === 'NotReadableError' || name === 'AbortError') return 'in-use';
  if (error instanceof TypeError) return 'unsupported';
  return 'error';
}

/** Primary camera + microphone via getUserMedia (PRD §3: "Primary camera"). */
export function useLocalMedia({ autoStart = false }: { autoStart?: boolean } = {}): LocalMedia {
  const [state, setState] = useState<LocalMediaState>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCleanupRef = useRef<(() => void) | null>(null);
  /** Bumped on every start/stop so a getUserMedia call that resolves late is discarded. */
  const requestIdRef = useRef(0);

  const stop = useCallback(() => {
    requestIdRef.current += 1;
    audioCleanupRef.current?.();
    audioCleanupRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setAudioLevel(0);
    setState('idle');
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setState('unsupported');
      return;
    }
    stop();
    setState('requesting');
    const requestId = (requestIdRef.current += 1);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (requestId !== requestIdRef.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = media;
      setStream(media);
      setState('ready');
      media.getTracks().forEach((track) =>
        track.addEventListener('ended', () => {
          if (streamRef.current === media) setState('ended');
        }),
      );

      // Microphone level meter
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx && media.getAudioTracks().length > 0) {
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(media);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const buffer = new Uint8Array(analyser.fftSize);
        const id = window.setInterval(() => {
          analyser.getByteTimeDomainData(buffer);
          let sum = 0;
          for (const v of buffer) sum += ((v - 128) / 128) ** 2;
          setAudioLevel(Math.min(1, Math.sqrt(sum / buffer.length) * 4));
        }, 100);
        audioCleanupRef.current = () => {
          window.clearInterval(id);
          source.disconnect();
          void ctx.close();
        };
      }
    } catch (err) {
      if (requestId === requestIdRef.current) setState(classify(err));
    }
  }, [stop]);

  useEffect(() => {
    if (autoStart) void start();
    return () => {
      requestIdRef.current += 1;
      audioCleanupRef.current?.();
      audioCleanupRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [autoStart, start]);

  return {
    state,
    stream,
    hasVideo: Boolean(stream?.getVideoTracks().some((t) => t.readyState === 'live')),
    hasAudio: Boolean(stream?.getAudioTracks().some((t) => t.readyState === 'live')),
    audioLevel,
    errorMessage: state in messages ? messages[state as keyof typeof messages] : null,
    start,
    stop,
  };
}
