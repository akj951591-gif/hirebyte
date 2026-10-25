import { useEffect, useRef, useState } from 'react';
import { ConnectionState, DisconnectReason, Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from 'livekit-client';
import type { MediaTokenResponse } from '@/api/client';
import { toApiError } from '@/api/client/useAsync';

/**
 * LiveKit room connections (PRD §9.1). Tokens come from POST /interviews/:id/media-token and are
 * short-lived and role-scoped; the LiveKit secret never reaches the browser. LiveKit handles brief
 * network drops itself; after a full disconnect we fetch a fresh token and rejoin.
 */
export type RoomStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable' | 'error';
export interface RoomState {
  status: RoomStatus;
  error: string | null;
}

type GetToken = () => Promise<MediaTokenResponse>;
const RETRY_MS = 3000;
const MAX_RETRIES = 5;

/** Connects with retries. `onConnected` runs after every (re)connect. Returns a cleanup function. */
function manageRoom(room: Room, getToken: GetToken, setState: (s: RoomState) => void, onConnected: () => Promise<void>) {
  let stopped = false;
  let retries = 0;
  let timer: number | undefined;

  const connect = async () => {
    if (stopped) return;
    setState({ status: retries ? 'reconnecting' : 'connecting', error: null });
    try {
      const { url, token } = await getToken();
      if (stopped) return;
      await room.connect(url, token);
      if (stopped) return void room.disconnect();
      retries = 0;
      await onConnected();
      setState({ status: 'connected', error: null });
    } catch (err) {
      if (stopped) return;
      const apiError = toApiError(err);
      // Not configured, or a credential/state problem: retrying will not help.
      if (apiError.code === 'MEDIA_NOT_CONFIGURED') return setState({ status: 'unavailable', error: null });
      if (['UNAUTHENTICATED', 'SESSION_EXPIRED', 'FORBIDDEN', 'CONFLICT', 'VALIDATION_ERROR'].includes(apiError.code) || retries >= MAX_RETRIES) {
        return setState({ status: 'error', error: apiError.message });
      }
      retries += 1;
      timer = window.setTimeout(() => void connect(), RETRY_MS);
    }
  };

  room.on(RoomEvent.ConnectionStateChanged, (state) => {
    if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) setState({ status: 'reconnecting', error: null });
    if (state === ConnectionState.Connected) setState({ status: 'connected', error: null });
  });
  room.on(RoomEvent.Disconnected, (reason) => {
    if (stopped || reason === DisconnectReason.CLIENT_INITIATED) return;
    // Another device took this identity (e.g. a newer phone paired): do not fight over it.
    if (reason === DisconnectReason.DUPLICATE_IDENTITY) return setState({ status: 'error', error: 'This camera was replaced by another device.' });
    retries += 1;
    timer = window.setTimeout(() => void connect(), RETRY_MS);
  });

  void connect();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    void room.disconnect();
  };
}

/**
 * Publishes the local camera (and microphone, if present) of the candidate's laptop or phone.
 * With `watchPhone` (the laptop), the same connection also receives the candidate's own phone camera,
 * returned as `phone` (null until the phone is connected).
 */
export function usePublishToRoom({
  getToken,
  stream,
  enabled,
  watchPhone = false,
}: {
  getToken: GetToken;
  stream: MediaStream | null;
  enabled: boolean;
  watchPhone?: boolean;
}): RoomState & { phone: MediaStream | null } {
  const [state, setState] = useState<RoomState>({ status: 'idle', error: null });
  const [phone, setPhone] = useState<MediaStream | null>(null);
  const tokenRef = useRef(getToken);
  useEffect(() => {
    tokenRef.current = getToken;
  });

  useEffect(() => {
    if (!enabled || !stream) {
      setState({ status: 'idle', error: null });
      setPhone(null);
      return;
    }
    // Adaptive streaming can pause a track that is not attached through the SDK, and the phone video
    // is shown from its raw MediaStreamTrack, so it is off when watching the phone.
    const room = new Room({ adaptiveStream: !watchPhone, dynacast: true });
    if (watchPhone) {
      const phoneTracks = new Map<string, MediaStreamTrack>();
      const isPhone = (p: RemoteParticipant) => p.identity.startsWith('candidate-secondary:');
      const showPhone = () => setPhone(phoneTracks.size ? new MediaStream([...phoneTracks.values()]) : null);
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant) => {
        if (!isPhone(participant) || track.kind !== Track.Kind.Video) return;
        phoneTracks.set(track.sid ?? track.mediaStreamTrack.id, track.mediaStreamTrack);
        showPhone();
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant) => {
        if (!isPhone(participant)) return;
        phoneTracks.delete(track.sid ?? track.mediaStreamTrack.id);
        showPhone();
      });
    }
    const cleanup = manageRoom(room, () => tokenRef.current(), setState, async () => {
      for (const track of stream.getTracks()) {
        if (track.readyState !== 'live') continue;
        await room.localParticipant.publishTrack(track, { source: track.kind === 'video' ? Track.Source.Camera : Track.Source.Microphone });
      }
    });
    return () => {
      cleanup();
      setPhone(null);
    };
  }, [enabled, stream, watchPhone]);

  return { ...state, phone };
}

/** Recruiter live view (hidden, subscribe-only): the candidate's laptop (video + audio) and phone video. */
export function useWatchRoom({ getToken, enabled }: { getToken: GetToken; enabled: boolean }): RoomState & { laptop: MediaStream | null; phone: MediaStream | null } {
  const [state, setState] = useState<RoomState>({ status: 'idle', error: null });
  const [streams, setStreams] = useState<{ laptop: MediaStream | null; phone: MediaStream | null }>({ laptop: null, phone: null });
  const tokenRef = useRef(getToken);
  useEffect(() => {
    tokenRef.current = getToken;
  });

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', error: null });
      return;
    }
    const room = new Room({ adaptiveStream: true });
    const tracks = { laptop: new Map<string, MediaStreamTrack>(), phone: new Map<string, MediaStreamTrack>() };
    const roleOf = (p: RemoteParticipant) =>
      p.identity.startsWith('candidate-primary:') ? 'laptop' : p.identity.startsWith('candidate-secondary:') ? 'phone' : null;
    const publish = () =>
      setStreams({
        laptop: tracks.laptop.size ? new MediaStream([...tracks.laptop.values()]) : null,
        phone: tracks.phone.size ? new MediaStream([...tracks.phone.values()]) : null,
      });
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant) => {
      const role = roleOf(participant);
      if (!role || (role === 'phone' && track.kind !== Track.Kind.Video)) return;
      tracks[role].set(track.sid ?? track.mediaStreamTrack.id, track.mediaStreamTrack);
      publish();
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant) => {
      const role = roleOf(participant);
      if (!role) return;
      tracks[role].delete(track.sid ?? track.mediaStreamTrack.id);
      publish();
    });
    const cleanup = manageRoom(room, () => tokenRef.current(), setState, async () => undefined);
    return () => {
      cleanup();
      setStreams({ laptop: null, phone: null });
    };
  }, [enabled]);

  return { ...state, ...streams };
}
