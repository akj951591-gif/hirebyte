import { useCallback, useState } from 'react';
import { api, ApiError } from '@/api/client';
import { toApiError } from '@/api/client/useAsync';

export type PlaybackState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; url: string; expiresAt: string }
  | { status: 'expired' }
  | { status: 'error'; error: ApiError };

/**
 * Requests a short-lived signed playback URL only when the recruiter asks to watch (PRD §9.2.12).
 * The URL is held in memory for the player and never logged or stored.
 */
export function usePlaybackUrl(recordingId: string) {
  const [state, setState] = useState<PlaybackState>({ status: 'idle' });

  const request = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const { url, expiresAt } = await api.recordings.playbackUrl(recordingId);
      setState({ status: 'ready', url, expiresAt });
    } catch (err) {
      setState({ status: 'error', error: toApiError(err) });
    }
  }, [recordingId]);

  /** Called when the <video> fails to load; distinguishes an expired link from a broken file. */
  const reportPlaybackFailure = useCallback(() => {
    setState((s) => {
      if (s.status !== 'ready') return s;
      if (new Date(s.expiresAt).getTime() <= Date.now()) return { status: 'expired' };
      return { status: 'error', error: new ApiError('PLAYBACK_FAILED', 'The recording file could not be played.', 0) };
    });
  }, []);

  return { state, request, reportPlaybackFailure, reset: () => setState({ status: 'idle' }) };
}
