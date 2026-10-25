import { useEffect, useRef, useState } from 'react';
import type { CameraSource, CreateProctoringEventRequest } from '@/api/client';
import { appConfig } from '@/config/app.config';
import { createFaceAnalyzer, createPersonAnalyzer } from '../faceDetector';
import { EpisodeTracker, LookingAwayDetector, OBSERVATION_RULES, toEventRequest, type Episode, type ObservationType } from '../observations';

export type ObservationStatus = 'off' | 'loading' | 'active' | 'unavailable';
type Report = (request: CreateProctoringEventRequest) => Promise<unknown>;
/** Called when a condition starts or stops happening, so the candidate can be told right away. */
export type LiveChange = (type: ObservationType, active: boolean) => void;

/** Calls `onChange` only when a tracker's live state flips. */
function liveNotifier(onChange: () => LiveChange | undefined) {
  const state = new Map<ObservationType, boolean>();
  return {
    check(tracker: EpisodeTracker, now: number) {
      const active = tracker.sustained(now);
      if (state.get(tracker.type) === active) return;
      state.set(tracker.type, active);
      onChange()?.(tracker.type, active);
    },
    clear() {
      for (const [type, active] of state) if (active) onChange()?.(type, false);
      state.clear();
    },
  };
}

/**
 * Watches a camera stream with MediaPipe and reports observation episodes (PRD §13).
 * Laptop (PRIMARY): no face, more than one face, looking away. Phone (SECONDARY): more than one person.
 * A model that cannot load leaves the interview untouched and reports 'unavailable'.
 */
export function useCameraObservations({
  stream,
  enabled,
  camera,
  report,
  onLiveChange,
}: {
  stream: MediaStream | null;
  enabled: boolean;
  camera: CameraSource;
  report: Report;
  onLiveChange?: LiveChange;
}): ObservationStatus {
  const [status, setStatus] = useState<ObservationStatus>('off');
  const reportRef = useRef(report);
  const liveRef = useRef(onLiveChange);
  useEffect(() => {
    reportRef.current = report;
    liveRef.current = onLiveChange;
  });

  useEffect(() => {
    if (!enabled || !stream || stream.getVideoTracks().length === 0) {
      setStatus('off');
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    let closeModel: (() => void) | undefined;
    const send = (episode: Episode | null) => {
      if (episode) void reportRef.current(toEventRequest(episode, camera)).catch(() => undefined);
    };

    const absent = new EpisodeTracker('FACE_ABSENT', OBSERVATION_RULES.FACE_ABSENT);
    const multiple = new EpisodeTracker('MULTIPLE_FACES', OBSERVATION_RULES.MULTIPLE_FACES);
    const away = new EpisodeTracker('LOOKING_AWAY', OBSERVATION_RULES.LOOKING_AWAY);
    const looking = new LookingAwayDetector();
    const trackers = camera === 'PRIMARY' ? [absent, multiple, away] : [multiple];
    const live = liveNotifier(() => liveRef.current);

    // A private, muted <video> keeps analysis independent of what the page renders.
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    setStatus('loading');

    (async () => {
      try {
        await video.play();
        const intervalMs = 1000 / appConfig.vision.framesPerSecond;
        if (camera === 'PRIMARY') {
          const analyzer = await createFaceAnalyzer();
          closeModel = () => analyzer.close();
          if (cancelled) return closeModel();
          timer = window.setInterval(() => {
            if (video.readyState < 2) return;
            const frame = analyzer.analyze(video, performance.now());
            const now = Date.now();
            send(absent.update(frame.faces === 0, now));
            send(multiple.update(frame.faces > 1, now));
            send(away.update(frame.faces === 1 && frame.pose !== null && looking.update(frame.pose), now));
            for (const tracker of trackers) live.check(tracker, now);
          }, intervalMs);
        } else {
          const analyzer = await createPersonAnalyzer();
          closeModel = () => analyzer.close();
          if (cancelled) return closeModel();
          timer = window.setInterval(() => {
            if (video.readyState < 2) return;
            send(multiple.update(analyzer.countPeople(video, performance.now()) > 1, Date.now()));
          }, intervalMs);
        }
        setStatus('active');
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    })();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      const now = Date.now();
      for (const tracker of trackers) send(tracker.flush(now));
      live.clear();
      closeModel?.();
      video.srcObject = null;
    };
  }, [enabled, stream, camera]);

  return status;
}

/** Reports when the interview tab is hidden or the window loses focus for more than a second. */
export function useTabObservations({ enabled, report, onLiveChange }: { enabled: boolean; report: Report; onLiveChange?: LiveChange }): void {
  const reportRef = useRef(report);
  const liveRef = useRef(onLiveChange);
  useEffect(() => {
    reportRef.current = report;
    liveRef.current = onLiveChange;
  });

  useEffect(() => {
    if (!enabled) return;
    const tracker = new EpisodeTracker('TAB_HIDDEN', OBSERVATION_RULES.TAB_HIDDEN);
    const live = liveNotifier(() => liveRef.current);
    const send = (episode: Episode | null) => {
      if (episode) void reportRef.current(toEventRequest(episode, 'PRIMARY')).catch(() => undefined);
    };
    const check = () => {
      const now = Date.now();
      send(tracker.update(document.hidden || !document.hasFocus(), now));
      live.check(tracker, now);
    };
    const timer = window.setInterval(check, 250);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('blur', check);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('blur', check);
      window.removeEventListener('focus', check);
      send(tracker.flush(Date.now()));
      live.clear();
    };
  }, [enabled]);
}
