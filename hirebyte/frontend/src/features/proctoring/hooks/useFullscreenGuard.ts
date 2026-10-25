import { useCallback, useEffect, useRef, useState } from 'react';

const fullscreenSupported = () =>
  typeof document !== 'undefined' && document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function';

/**
 * Keeps the interview in full screen. `required` is true while the page should block until the
 * candidate (re)enters full screen, which needs a click. Once full screen has been entered, leaving
 * it calls `onExit` (the interview ends). A reload starts outside full screen, so it asks again
 * instead of ending. Call `release` before finishing on purpose so that leaving is not an exit.
 * Browsers without the Fullscreen API (e.g. iPhone Safari) are not blocked.
 */
export function useFullscreenGuard({ enabled, onExit }: { enabled: boolean; onExit: () => void }) {
  const supported = fullscreenSupported();
  const [isFullscreen, setIsFullscreen] = useState(() => typeof document !== 'undefined' && Boolean(document.fullscreenElement));
  const armedRef = useRef(isFullscreen);
  const releasedRef = useRef(false);
  const enabledRef = useRef(enabled);
  const onExitRef = useRef(onExit);
  useEffect(() => {
    enabledRef.current = enabled;
    onExitRef.current = onExit;
  });

  useEffect(() => {
    releasedRef.current = false;
    const onChange = () => {
      const full = Boolean(document.fullscreenElement);
      setIsFullscreen(full);
      if (full) {
        armedRef.current = true;
        return;
      }
      if (armedRef.current && enabledRef.current && !releasedRef.current) {
        armedRef.current = false;
        onExitRef.current();
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      // Leaving the page is never an "exit" violation; hand the screen back.
      releasedRef.current = true;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const enter = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // The browser refused (no user gesture, policy): the gate stays up so the candidate can retry.
    }
  }, []);

  const release = useCallback(() => {
    releasedRef.current = true;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  return { supported, isFullscreen, required: supported && enabled && !isFullscreen, enter, release };
}
