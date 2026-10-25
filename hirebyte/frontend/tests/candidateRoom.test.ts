import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCandidateAlerts } from '@/features/proctoring/hooks/useCandidateAlerts';
import { useFullscreenGuard } from '@/features/proctoring/hooks/useFullscreenGuard';
import { pickFemaleVoice } from '@/features/voice/ttsAdapter';

const voice = (name: string, lang: string, localService = true) => ({ name, lang, localService, default: false, voiceURI: name }) as SpeechSynthesisVoice;

describe('interviewer voice', () => {
  it('picks a female English voice on a typical Windows list', () => {
    const voices = [voice('Microsoft David - English (United States)', 'en-US'), voice('Microsoft Zira - English (United States)', 'en-US'), voice('Microsoft Mark - English (United States)', 'en-US')];
    expect(pickFemaleVoice(voices)?.name).toContain('Zira');
  });

  it('prefers a natural Indian-English female voice when there is one', () => {
    const voices = [
      voice('Microsoft Zira - English (United States)', 'en-US'),
      voice('Microsoft Neerja Online (Natural) - English (India)', 'en-IN', false),
      voice('Google UK English Female', 'en-GB', false),
    ];
    expect(pickFemaleVoice(voices)?.name).toContain('Neerja');
  });

  it('works with macOS, iOS and Chrome names', () => {
    expect(pickFemaleVoice([voice('Alex', 'en-US'), voice('Samantha', 'en-US')])?.name).toBe('Samantha');
    expect(pickFemaleVoice([voice('Google US English', 'en-US', false), voice('Google UK English Female', 'en_GB', false)])?.name).toBe('Google UK English Female');
  });

  it('ignores non-English voices and returns nothing when only male voices exist', () => {
    expect(pickFemaleVoice([voice('Google français Female', 'fr-FR')])).toBeUndefined();
    expect(pickFemaleVoice([voice('Microsoft David - English (United States)', 'en-US'), voice('Alex', 'en-US')])).toBeUndefined();
    expect(pickFemaleVoice([])).toBeUndefined();
  });
});

describe('candidate alerts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows an alert while it happens and keeps it briefly after it stops', () => {
    const { result } = renderHook(() => useCandidateAlerts(6000));
    act(() => result.current.onLiveChange('FACE_ABSENT', true));
    expect(result.current.alerts).toHaveLength(1);
    expect(result.current.alerts[0]!.message).toContain("can't see your face");

    act(() => result.current.onLiveChange('FACE_ABSENT', false));
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current.alerts).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(1500));
    expect(result.current.alerts).toHaveLength(0);
  });

  it('keeps one alert per kind, newest first, and a returning condition cancels the removal', () => {
    const { result } = renderHook(() => useCandidateAlerts(6000));
    act(() => result.current.onLiveChange('LOOKING_AWAY', true));
    act(() => result.current.onLiveChange('TAB_HIDDEN', true));
    act(() => result.current.onLiveChange('TAB_HIDDEN', true));
    expect(result.current.alerts.map((a) => a.type)).toEqual(['TAB_HIDDEN', 'LOOKING_AWAY']);

    act(() => result.current.onLiveChange('LOOKING_AWAY', false));
    act(() => void vi.advanceTimersByTime(3000));
    act(() => result.current.onLiveChange('LOOKING_AWAY', true));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(result.current.alerts.map((a) => a.type)).toContain('LOOKING_AWAY');
  });
});

/** jsdom has no Fullscreen API: a small fake that fires the same change events a browser does. */
function installFakeFullscreen(enabled = true) {
  let element: Element | null = null;
  Object.defineProperty(document, 'fullscreenEnabled', { value: enabled, configurable: true });
  Object.defineProperty(document, 'fullscreenElement', { get: () => element, configurable: true });
  const change = () => document.dispatchEvent(new Event('fullscreenchange'));
  document.documentElement.requestFullscreen = vi.fn(async () => {
    element = document.documentElement;
    change();
  });
  document.exitFullscreen = vi.fn(async () => {
    element = null;
    change();
  });
  return {
    /** The candidate presses Esc. */
    leave() {
      element = null;
      change();
    },
  };
}

describe('full screen guard', () => {
  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).fullscreenEnabled;
    delete (document as unknown as Record<string, unknown>).fullscreenElement;
  });

  it('asks for full screen first, and ends the interview when the candidate leaves it', async () => {
    const browser = installFakeFullscreen();
    const onExit = vi.fn();
    const { result } = renderHook(() => useFullscreenGuard({ enabled: true, onExit }));
    expect(result.current.required).toBe(true);

    await act(async () => result.current.enter());
    expect(result.current.isFullscreen).toBe(true);
    expect(result.current.required).toBe(false);
    expect(onExit).not.toHaveBeenCalled();

    act(() => browser.leave());
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(result.current.required).toBe(true);
  });

  it('does not end anything after a reload, when full screen was never entered on this page', () => {
    const browser = installFakeFullscreen();
    const onExit = vi.fn();
    renderHook(() => useFullscreenGuard({ enabled: true, onExit }));
    act(() => browser.leave());
    expect(onExit).not.toHaveBeenCalled();
  });

  it('does not treat finishing on purpose as leaving', async () => {
    installFakeFullscreen();
    const onExit = vi.fn();
    const { result } = renderHook(() => useFullscreenGuard({ enabled: true, onExit }));
    await act(async () => result.current.enter());
    act(() => result.current.release());
    expect(onExit).not.toHaveBeenCalled();
  });

  it('asks for nothing before the interview is running or where full screen is unavailable', () => {
    installFakeFullscreen();
    expect(renderHook(() => useFullscreenGuard({ enabled: false, onExit: vi.fn() })).result.current.required).toBe(false);
    installFakeFullscreen(false);
    expect(renderHook(() => useFullscreenGuard({ enabled: true, onExit: vi.fn() })).result.current.required).toBe(false);
  });
});
