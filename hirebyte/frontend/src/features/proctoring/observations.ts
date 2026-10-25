import type { CameraSource, CreateProctoringEventRequest } from '@/api/client';

/**
 * Turns per-frame camera signals into observation "episodes" for the recruiter's timeline
 * (PRD §13: observations for human review, never an automatic verdict). Pure logic, no camera.
 */
export type ObservationType = CreateProctoringEventRequest['type'];

export interface ObservationRule {
  /** The condition must hold this long before it counts. */
  minDurationMs: number;
  /** Short interruptions (e.g. one missed frame) shorter than this do not end an episode. */
  gapToleranceMs: number;
}

export const OBSERVATION_RULES: Record<Exclude<ObservationType, 'AUDIO_ISSUE'>, ObservationRule> = {
  FACE_ABSENT: { minDurationMs: 3000, gapToleranceMs: 800 },
  MULTIPLE_FACES: { minDurationMs: 1500, gapToleranceMs: 800 },
  LOOKING_AWAY: { minDurationMs: 4000, gapToleranceMs: 800 },
  TAB_HIDDEN: { minDurationMs: 1000, gapToleranceMs: 0 },
};

/** A long episode is reported in slices so the recruiter sees it while it is still happening. */
export const MAX_EPISODE_MS = 30_000;

export interface Episode {
  type: ObservationType;
  startedAt: number;
  durationMs: number;
}

/** Tracks one condition over time and emits an episode once it ends (or reaches MAX_EPISODE_MS). */
export class EpisodeTracker {
  private start: number | null = null;
  private lastActive = 0;

  constructor(
    readonly type: ObservationType,
    private readonly rule: ObservationRule,
  ) {}

  /**
   * True while the condition is happening and has held long enough to count, so the candidate can be
   * told right away instead of after the episode ends.
   */
  sustained(now: number): boolean {
    return this.start !== null && now - this.lastActive <= this.rule.gapToleranceMs && this.lastActive - this.start >= this.rule.minDurationMs;
  }

  /** Feed the condition at time `now` (ms). Returns a finished episode, if any. */
  update(active: boolean, now: number): Episode | null {
    if (active) {
      if (this.start === null) this.start = now;
      this.lastActive = now;
      if (now - this.start >= MAX_EPISODE_MS) return this.close(now, now);
      return null;
    }
    if (this.start !== null && now - this.lastActive > this.rule.gapToleranceMs) return this.close(this.lastActive, null);
    return null;
  }

  /** Ends any open episode (interview finished, page closing). */
  flush(now: number): Episode | null {
    return this.start === null ? null : this.close(Math.min(now, this.lastActive || now), null);
  }

  private close(end: number, restartAt: number | null): Episode | null {
    const startedAt = this.start!;
    this.start = restartAt;
    const durationMs = end - startedAt;
    return durationMs >= this.rule.minDurationMs ? { type: this.type, startedAt, durationMs } : null;
  }
}

/**
 * Yaw and pitch in degrees from MediaPipe's facial transformation matrix (4x4, column-major,
 * the layout three.js `Matrix4.fromArray` expects).
 */
export function headPose(matrix: number[]): { yaw: number; pitch: number } {
  const r20 = matrix[2] ?? 0;
  const r21 = matrix[6] ?? 0;
  const r22 = matrix[10] ?? 1;
  const toDeg = 180 / Math.PI;
  return {
    yaw: Math.atan2(-r20, Math.hypot(r21, r22)) * toDeg,
    pitch: Math.atan2(r21, r22) * toDeg,
  };
}

/** Smallest signed difference between two angles in degrees. */
export function angleDelta(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)]!;
};

/**
 * "Looking away" relative to the candidate's own normal position: the first few seconds with a
 * face set the baseline, so camera placement and posture do not cause false observations.
 */
export class LookingAwayDetector {
  private samples: Array<{ yaw: number; pitch: number }> = [];
  private baseline: { yaw: number; pitch: number } | null = null;

  constructor(
    private readonly maxYawDeg = 28,
    private readonly maxPitchDeg = 22,
    private readonly calibrationFrames = 12,
  ) {}

  get calibrated(): boolean {
    return this.baseline !== null;
  }

  /** Returns true when the head is turned well away from the baseline. Never true while calibrating. */
  update(pose: { yaw: number; pitch: number }): boolean {
    if (!this.baseline) {
      this.samples.push(pose);
      if (this.samples.length >= this.calibrationFrames) {
        this.baseline = { yaw: median(this.samples.map((s) => s.yaw)), pitch: median(this.samples.map((s) => s.pitch)) };
      }
      return false;
    }
    return Math.abs(angleDelta(pose.yaw, this.baseline.yaw)) > this.maxYawDeg || Math.abs(angleDelta(pose.pitch, this.baseline.pitch)) > this.maxPitchDeg;
  }
}

/** What the candidate sees while an observation is happening: a plain request, never an accusation. */
export const CANDIDATE_ALERTS: Record<ObservationType, string> = {
  FACE_ABSENT: "We can't see your face. Please sit in front of the camera.",
  MULTIPLE_FACES: 'More than one person is visible. Please make sure you are alone.',
  LOOKING_AWAY: 'Please keep your eyes on the screen.',
  TAB_HIDDEN: 'You left the interview window. Please stay on this page.',
  AUDIO_ISSUE: 'We could not hear your microphone. Please check it.',
};

const seconds = (ms: number) => Math.round(ms / 100) / 10;

/** The API request for an episode, with a plain description for the recruiter. */
export function toEventRequest(episode: Episode, sourceCamera: CameraSource): CreateProctoringEventRequest {
  const where = sourceCamera === 'SECONDARY' ? 'phone camera' : 'laptop camera';
  const s = seconds(episode.durationMs);
  const description: Record<ObservationType, string> = {
    FACE_ABSENT: `No face visible on the ${where} for ${s}s.`,
    MULTIPLE_FACES: sourceCamera === 'SECONDARY' ? `More than one person seen on the phone camera for ${s}s.` : `More than one face seen on the laptop camera for ${s}s.`,
    LOOKING_AWAY: `Head turned away from the screen for ${s}s.`,
    TAB_HIDDEN: `The interview tab was hidden or out of focus for ${s}s.`,
    AUDIO_ISSUE: `Microphone audio was interrupted for ${s}s.`,
  };
  return {
    type: episode.type,
    occurredAt: new Date(episode.startedAt).toISOString(),
    durationSeconds: s,
    sourceCamera,
    description: description[episode.type],
  };
}
