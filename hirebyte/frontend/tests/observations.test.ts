import { describe, expect, it } from 'vitest';
import { angleDelta, EpisodeTracker, headPose, LookingAwayDetector, MAX_EPISODE_MS, OBSERVATION_RULES, toEventRequest } from '@/features/proctoring/observations';

/** Feeds `active` at 250 ms steps (4 fps) and collects finished episodes. */
function run(tracker: EpisodeTracker, pattern: Array<[active: boolean, ms: number]>, start = 0) {
  const episodes = [];
  let t = start;
  for (const [active, ms] of pattern) {
    for (let elapsed = 0; elapsed < ms; elapsed += 250, t += 250) {
      const e = tracker.update(active, t);
      if (e) episodes.push(e);
    }
  }
  return { episodes, end: t };
}

describe('observation episodes (PRD §13: for human review)', () => {
  it('ignores short blips and reports sustained conditions once, with their duration', () => {
    const tracker = new EpisodeTracker('FACE_ABSENT', OBSERVATION_RULES.FACE_ABSENT);
    const { episodes } = run(tracker, [[false, 1000], [true, 1000], [false, 2000], [true, 5000], [false, 2000]]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ type: 'FACE_ABSENT', startedAt: 4000 });
    expect(episodes[0]!.durationMs).toBeGreaterThanOrEqual(4500);
  });

  it('bridges a missed frame inside one episode instead of splitting it', () => {
    const tracker = new EpisodeTracker('MULTIPLE_FACES', OBSERVATION_RULES.MULTIPLE_FACES);
    const { episodes } = run(tracker, [[true, 1000], [false, 500], [true, 1000], [false, 2000]]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]!.startedAt).toBe(0);
  });

  it('reports very long episodes in slices so the recruiter sees them while they last', () => {
    const tracker = new EpisodeTracker('FACE_ABSENT', OBSERVATION_RULES.FACE_ABSENT);
    const { episodes } = run(tracker, [[true, MAX_EPISODE_MS * 2 + 1000]]);
    expect(episodes.map((e) => e.durationMs)).toEqual([MAX_EPISODE_MS, MAX_EPISODE_MS]);
    expect(tracker.flush(MAX_EPISODE_MS * 2 + 1000)).toBeNull(); // 750 ms left: under the 3 s minimum
  });

  it('flushes an open episode when the interview ends', () => {
    const tracker = new EpisodeTracker('LOOKING_AWAY', OBSERVATION_RULES.LOOKING_AWAY);
    const { end } = run(tracker, [[true, 6000]]);
    expect(tracker.flush(end)).toMatchObject({ type: 'LOOKING_AWAY', startedAt: 0 });
  });
});

describe('looking away', () => {
  /** Column-major 4x4 rotation for a yaw (about Y) and pitch (about X), in degrees. */
  const rotation = (yawDeg: number, pitchDeg: number) => {
    const y = (yawDeg * Math.PI) / 180;
    const p = (pitchDeg * Math.PI) / 180;
    // R = Ry(yaw) * Rx(pitch)
    const r = [
      [Math.cos(y), Math.sin(y) * Math.sin(p), Math.sin(y) * Math.cos(p)],
      [0, Math.cos(p), -Math.sin(p)],
      [-Math.sin(y), Math.cos(y) * Math.sin(p), Math.cos(y) * Math.cos(p)],
    ];
    const m = new Array<number>(16).fill(0);
    for (let row = 0; row < 3; row += 1) for (let col = 0; col < 3; col += 1) m[col * 4 + row] = r[row]![col]!;
    m[15] = 1;
    return m;
  };

  it('reads yaw and pitch from the transformation matrix', () => {
    const pose = headPose(rotation(30, -15));
    expect(pose.yaw).toBeCloseTo(30, 5);
    expect(pose.pitch).toBeCloseTo(-15, 5);
    expect(angleDelta(179, -179)).toBe(-2);
  });

  it('compares against the candidate’s own baseline, not an absolute angle', () => {
    const detector = new LookingAwayDetector();
    // Camera placed to the side: the candidate's normal yaw is ~20 degrees.
    for (let i = 0; i < 12; i += 1) expect(detector.update({ yaw: 20 + (i % 3), pitch: 5 })).toBe(false);
    expect(detector.calibrated).toBe(true);
    expect(detector.update({ yaw: 25, pitch: 8 })).toBe(false);
    expect(detector.update({ yaw: 55, pitch: 5 })).toBe(true);
    expect(detector.update({ yaw: 20, pitch: -25 })).toBe(true);
  });
});

describe('event requests', () => {
  it('describes each observation plainly, naming the camera', () => {
    expect(toEventRequest({ type: 'MULTIPLE_FACES', startedAt: Date.UTC(2026, 0, 1), durationMs: 2340 }, 'SECONDARY')).toEqual({
      type: 'MULTIPLE_FACES',
      occurredAt: '2026-01-01T00:00:00.000Z',
      durationSeconds: 2.3,
      sourceCamera: 'SECONDARY',
      description: 'More than one person seen on the phone camera for 2.3s.',
    });
    expect(toEventRequest({ type: 'TAB_HIDDEN', startedAt: 0, durationMs: 1000 }, 'PRIMARY').description).toBe('The interview tab was hidden or out of focus for 1s.');
  });
});
