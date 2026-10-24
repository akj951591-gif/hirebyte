import { describe, expect, it } from 'vitest';
import { assertTransition, CANCELLABLE_STATUSES, canTransition } from '../../src/services/interviews/stateMachine.js';
import { canTransitionRecording, statusForEgress } from '../../src/services/recordings/recordingStateMachine.js';

describe('interview state machine (PRD §8.1)', () => {
  it.each([
    ['DRAFT', 'READY'],
    ['READY', 'ONBOARDING'],
    ['ONBOARDING', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'COMPLETED'],
    ['COMPLETED', 'EVALUATING'],
    ['EVALUATING', 'EVALUATION_FAILED'],
    ['EVALUATION_FAILED', 'EVALUATING'],
    ['EVALUATED', 'REVIEWED'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['DRAFT', 'IN_PROGRESS'],
    ['READY', 'COMPLETED'],
    ['COMPLETED', 'IN_PROGRESS'],
    ['REVIEWED', 'DRAFT'],
    ['CANCELLED', 'READY'],
  ] as const)('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(/cannot move/);
  });

  it('allows cancelling only before the interview is finished', () => {
    expect([...CANCELLABLE_STATUSES].sort()).toEqual(['DRAFT', 'IN_PROGRESS', 'ONBOARDING', 'PROCESSING_ANSWER', 'READY']);
  });
});

describe('recording state machine (PRD §4.1)', () => {
  it('only reaches READY from FINALIZING and never moves backwards', () => {
    expect(canTransitionRecording('FINALIZING', 'READY')).toBe(true);
    expect(canTransitionRecording('RECORDING', 'READY')).toBe(false);
    expect(canTransitionRecording('READY', 'RECORDING')).toBe(false);
    expect(canTransitionRecording('FAILED', 'READY')).toBe(false);
    expect(canTransitionRecording('DELETED', 'READY')).toBe(false);
  });

  it('maps egress states without ever claiming READY', () => {
    expect(statusForEgress('STARTING')).toBeNull();
    expect(statusForEgress('ACTIVE')).toBe('RECORDING');
    expect(statusForEgress('COMPLETE')).toBe('FINALIZING');
    expect(statusForEgress('ABORTED')).toBe('FAILED');
    expect(statusForEgress('LIMIT_REACHED')).toBe('FAILED');
  });
});
