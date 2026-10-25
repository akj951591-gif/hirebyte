import type { FaceLandmarker, ObjectDetector } from '@mediapipe/tasks-vision';
import { appConfig } from '@/config/app.config';
import { headPose } from './observations';

/**
 * MediaPipe vision models running in the browser (PRD §3: MediaPipe observations). Nothing leaves
 * the device except the resulting observations. The library and models load lazily, only when
 * an interview actually starts, so other pages stay light.
 */
export interface FaceFrame {
  faces: number;
  /** Head pose of the first face, when one is visible. */
  pose: { yaw: number; pitch: number } | null;
}

export interface FaceAnalyzer {
  analyze(video: HTMLVideoElement, timestampMs: number): FaceFrame;
  close(): void;
}

export interface PersonAnalyzer {
  /** Number of people the model sees with reasonable confidence. */
  countPeople(video: HTMLVideoElement, timestampMs: number): number;
  close(): void;
}

async function fileset() {
  const vision = await import('@mediapipe/tasks-vision');
  return { vision, files: await vision.FilesetResolver.forVisionTasks(appConfig.vision.wasmBaseUrl) };
}

/** Laptop camera: up to two faces, with head pose for "looking away". */
export async function createFaceAnalyzer(): Promise<FaceAnalyzer> {
  const { vision, files } = await fileset();
  const landmarker: FaceLandmarker = await vision.FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: appConfig.vision.faceModelUrl, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 2,
    outputFacialTransformationMatrixes: true,
  });
  return {
    analyze(video, timestampMs) {
      const result = landmarker.detectForVideo(video, timestampMs);
      const matrix = result.facialTransformationMatrixes?.[0]?.data;
      return { faces: result.faceLandmarks.length, pose: matrix ? headPose(matrix) : null };
    },
    close: () => landmarker.close(),
  };
}

/** Phone camera (side view): counts people, since faces are often not visible from the side. */
export async function createPersonAnalyzer(): Promise<PersonAnalyzer> {
  const { vision, files } = await fileset();
  const detector: ObjectDetector = await vision.ObjectDetector.createFromOptions(files, {
    baseOptions: { modelAssetPath: appConfig.vision.personModelUrl, delegate: 'GPU' },
    runningMode: 'VIDEO',
    categoryAllowlist: ['person'],
    scoreThreshold: 0.5,
    maxResults: 5,
  });
  return {
    countPeople: (video, timestampMs) => detector.detectForVideo(video, timestampMs).detections.length,
    close: () => detector.close(),
  };
}
