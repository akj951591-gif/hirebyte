/**
 * Text-to-speech adapter (PRD §8.4): speak(questionText), stop(), playback state.
 * Browser SpeechSynthesis for the prototype; swap the implementation without touching pages.
 */
export type TtsState = 'idle' | 'speaking' | 'unsupported';

export interface TtsAdapter {
  readonly isSupported: boolean;
  speak(text: string, options?: { onEnd?: () => void }): void;
  stop(): void;
  getState(): TtsState;
  subscribe(listener: (state: TtsState) => void): () => void;
}

export function createBrowserTts(): TtsAdapter {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const isSupported = Boolean(synth && typeof SpeechSynthesisUtterance !== 'undefined');
  let state: TtsState = isSupported ? 'idle' : 'unsupported';
  const listeners = new Set<(s: TtsState) => void>();
  const set = (next: TtsState) => {
    state = next;
    listeners.forEach((l) => l(next));
  };

  const pickVoice = () => {
    const voices = synth?.getVoices() ?? [];
    return voices.find((v) => v.lang.startsWith('en') && v.localService) ?? voices.find((v) => v.lang.startsWith('en'));
  };

  return {
    isSupported,
    speak(text, options) {
      if (!synth || !isSupported) {
        options?.onEnd?.();
        return;
      }
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = 0.95;
      utterance.onstart = () => set('speaking');
      utterance.onend = () => {
        set('idle');
        options?.onEnd?.();
      };
      utterance.onerror = () => {
        set('idle');
        options?.onEnd?.();
      };
      synth.speak(utterance);
    },
    stop() {
      if (!synth || !isSupported) return;
      synth.cancel();
      set('idle');
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
