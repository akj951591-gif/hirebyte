// Central product identity. Pages read branding from here instead of hard-coding it (PRD §7.3).
export const appConfig = {
  productName: 'HireByte',
  tagline: 'AI-assisted interview screening',
  companyName: 'HireByte',
  supportEmail: 'support@hirebyte.test',
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api',
  /** Recruiter live view poll interval when the realtime socket is not connected. */
  monitorPollMs: 5000,
  /** Candidate pairing status poll interval when the realtime socket is not connected. */
  pairingPollMs: 4000,
  /** Slow safety poll while the socket is connected (covers changes that have no event, e.g. laptop camera). */
  realtimeSafetyPollMs: 30_000,
  /**
   * In-browser camera checks (MediaPipe). Public files; the wasm version must match the installed
   * @mediapipe/tasks-vision package. Self-host them by pointing these at /public paths.
   */
  vision: {
    wasmBaseUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm',
    faceModelUrl: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    personModelUrl: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
    /** Frames analysed per second; low enough to leave the CPU for the interview itself. */
    framesPerSecond: 4,
  },
} as const;

export type AppConfig = typeof appConfig;
