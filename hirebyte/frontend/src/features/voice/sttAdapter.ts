/**
 * Speech-to-text adapter (PRD §8.4): startCapture(), stopCapture(), transcript plus
 * confidence/availability. Browser SpeechRecognition for the prototype; a hosted provider can
 * implement the same interface later.
 */
export type SttErrorCode = 'not-allowed' | 'no-speech' | 'audio-capture' | 'network' | 'unsupported' | 'unknown';

export interface SttResult {
  /** Final text recognised so far in this capture. */
  transcript: string;
  /** Text still being recognised (may change). */
  interim: string;
  /** Average confidence of final segments, when the engine provides it. */
  confidence: number | null;
}

export interface SttHandlers {
  onResult: (result: SttResult) => void;
  onError: (code: SttErrorCode, message: string) => void;
  onEnd: () => void;
}

export interface SttAdapter {
  readonly isSupported: boolean;
  startCapture(handlers: SttHandlers): void;
  stopCapture(): void;
}

// Minimal typings — SpeechRecognition is not in the TypeScript DOM lib.
interface RecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const errorMessages: Record<SttErrorCode, string> = {
  'not-allowed': 'Microphone access for speech recognition was blocked. You can type your answer instead.',
  'no-speech': 'We did not hear anything. Check your microphone and try again, or type your answer.',
  'audio-capture': 'No microphone was available for speech recognition. You can type your answer instead.',
  network: 'Speech recognition lost its connection. Your words so far are kept; you can continue by typing.',
  unsupported: 'Speech recognition is not available in this browser. Please type your answers.',
  unknown: 'Speech recognition stopped unexpectedly. You can try again or type your answer.',
};

export function createBrowserStt(lang = 'en-US'): SttAdapter {
  const Ctor = getCtor();
  let recognition: Recognition | null = null;
  let capturing = false;

  return {
    isSupported: Boolean(Ctor),
    startCapture(handlers) {
      if (!Ctor) {
        handlers.onError('unsupported', errorMessages.unsupported);
        handlers.onEnd();
        return;
      }
      capturing = true;
      let finalText = '';
      const confidences: number[] = [];
      let restarts = 0;

      const begin = () => {
        const rec = new Ctor();
        recognition = rec;
        rec.lang = lang;
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (event) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            if (result.isFinal) {
              finalText = `${finalText} ${result[0].transcript}`.trim();
              if (result[0].confidence > 0) confidences.push(result[0].confidence);
            } else {
              interim += result[0].transcript;
            }
          }
          handlers.onResult({
            transcript: finalText,
            interim: interim.trim(),
            confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
          });
        };
        rec.onerror = (e) => {
          if (e.error === 'aborted') return;
          if (e.error === 'no-speech' && finalText) return; // silence after speaking is normal
          const code: SttErrorCode = (['not-allowed', 'no-speech', 'audio-capture', 'network'] as const).includes(e.error as never)
            ? (e.error as SttErrorCode)
            : e.error === 'service-not-allowed'
              ? 'not-allowed'
              : 'unknown';
          capturing = false;
          handlers.onError(code, errorMessages[code]);
        };
        rec.onend = () => {
          // Browsers end continuous recognition after pauses; keep listening until the user stops.
          if (capturing && restarts < 20) {
            restarts += 1;
            try {
              begin();
              return;
            } catch {
              // fall through to end
            }
          }
          capturing = false;
          recognition = null;
          handlers.onEnd();
        };
        rec.start();
      };

      try {
        begin();
      } catch {
        capturing = false;
        handlers.onError('unknown', errorMessages.unknown);
        handlers.onEnd();
      }
    },
    stopCapture() {
      capturing = false;
      recognition?.stop();
    },
  };
}
