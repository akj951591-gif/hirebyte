import type { Env } from '../../config/env.js';
import type { InterviewConfig } from '../../schemas/interview.schema.js';

/** Bump a version whenever the notice text changes; consent records store the version shown. */
export const RECORDING_NOTICE_VERSION = 'rec-notice-2026-10';
export const PROCTORING_NOTICE_VERSION = 'proc-notice-2026-10';

export function recordingNotice(env: Env, config: InterviewConfig, enabled: boolean) {
  const retention = env.RECORDING_RETENTION_DAYS
    ? `Recordings are deleted automatically ${env.RECORDING_RETENTION_DAYS} days after the interview.`
    : 'Recordings are kept only as long as the hiring team needs them for this role and are then deleted.';
  return {
    enabled,
    required: false,
    noticeVersion: RECORDING_NOTICE_VERSION,
    feeds: enabled
      ? ['Laptop camera video', 'Microphone audio', ...(config.secondaryCamera !== 'OFF' ? ['Phone camera video (if connected)'] : [])]
      : [],
    purpose: 'So the hiring team can review your answers accurately after the interview.',
    access: 'Only the recruiters responsible for this interview can watch the recording.',
    retention,
  };
}

export const proctoringNotice = {
  enabled: true,
  noticeVersion: PROCTORING_NOTICE_VERSION,
  description:
    'We note observable events such as the phone camera disconnecting or your face leaving the camera view. These are observations for a human reviewer, never an automatic decision.',
};

export function candidateInstructions(config: InterviewConfig): string[] {
  return [
    'Find a quiet, well-lit place and close other apps that use your camera or microphone.',
    'Each question is read aloud and shown on screen. Answer out loud; you can type instead if speech recognition is unavailable.',
    'Your answer is saved before the next question appears. If you refresh, you continue where you left off.',
    config.allowSkip
      ? 'You may skip a question, but skipped questions are marked as unanswered.'
      : 'Skipping questions is not enabled for this interview.',
  ];
}
