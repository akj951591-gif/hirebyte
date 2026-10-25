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

/**
 * Voice names that browsers and operating systems list for female English voices (Windows, macOS,
 * iOS, Chrome and Edge). Browsers do not expose a gender field, so the name is all there is.
 */
const FEMALE_VOICE_NAME =
  /\b(female|woman|zira|aria|jenny|sonia|libby|natasha|neerja|heera|swara|samantha|karen|moira|tessa|victoria|fiona|susan|hazel|catherine|allison|ava|emma|joanna|salli|kimberly|kendra)\b/i;

/** The most natural-sounding female English voice available, or undefined when there is none. */
export function pickFemaleVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const lang = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace('_', '-');
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|online/i.test(v.name) ? 4 : 0) + (lang(v) === 'en-in' ? 2 : lang(v) === 'en-us' || lang(v) === 'en-gb' ? 1 : 0) + (v.localService ? 0.5 : 0);
  return voices
    .filter((v) => lang(v).startsWith('en') && FEMALE_VOICE_NAME.test(v.name))
    .sort((a, b) => score(b) - score(a))[0];
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

  // Browsers load their voice list asynchronously, so look again whenever it changes.
  let female: SpeechSynthesisVoice | undefined;
  const refreshVoices = () => {
    female = pickFemaleVoice(synth?.getVoices() ?? []);
  };
  if (synth && isSupported) {
    refreshVoices();
    synth.addEventListener?.('voiceschanged', refreshVoices);
  }

  /** The interviewer's voice: female when the device has one, otherwise any English voice. */
  const pickVoice = () => {
    if (!female) refreshVoices();
    if (female) return female;
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
      // No female voice installed: raise the pitch a little so the default voice sounds lighter.
      utterance.pitch = female ? 1 : 1.2;
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
