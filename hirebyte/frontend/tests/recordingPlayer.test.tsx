import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, type Recording, type RecordingStatus } from '@/api/client';
import { RecordingPlayer } from '@/features/recordings';

const recording = (status: RecordingStatus, extra: Partial<Recording> = {}): Recording => ({
  id: 'rec_1',
  interviewId: 'int_1',
  status,
  mimeType: 'video/mp4',
  sizeBytes: 1000,
  durationSeconds: 60,
  startedAt: null,
  completedAt: null,
  failureCode: null,
  ...extra,
});

describe('RecordingPlayer', () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each<RecordingStatus>(['PENDING', 'RECORDING', 'FINALIZING', 'FAILED', 'DELETED', 'NOT_ENABLED'])(
    'never offers playback while %s',
    (status) => {
      render(<RecordingPlayer recording={recording(status)} />);
      expect(screen.queryByRole('button', { name: /watch recording/i })).not.toBeInTheDocument();
    },
  );

  it('shows the failure code for a failed recording', () => {
    render(<RecordingPlayer recording={recording('FAILED', { failureCode: 'EGRESS_START_FAILED' })} />);
    expect(screen.getByText(/recording failed/i)).toBeInTheDocument();
    expect(screen.getByText(/EGRESS_START_FAILED/)).toBeInTheDocument();
  });

  it('requests a signed URL only when the recruiter presses play', async () => {
    const playback = vi
      .spyOn(api.recordings, 'playbackUrl')
      .mockResolvedValue({ url: 'https://storage.example.test/signed', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const { container } = render(<RecordingPlayer recording={recording('READY')} />);
    expect(playback).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: /watch recording/i }));
    expect(playback).toHaveBeenCalledWith('rec_1');
    expect(await screen.findByText(/playback link valid until/i)).toBeInTheDocument();
    expect(container.querySelector('video')).toHaveAttribute('src', 'https://storage.example.test/signed');
  });

  it.each([
    ['FORBIDDEN', 403, /not authorised/i],
    ['RECORDING_DELETED', 410, /missing or deleted/i],
    ['RECORDING_UNAVAILABLE', 503, /recording unavailable/i],
  ])('handles %s from the playback API', async (code, status, text) => {
    vi.spyOn(api.recordings, 'playbackUrl').mockRejectedValue(new ApiError(code, 'msg', status));
    render(<RecordingPlayer recording={recording('READY')} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /watch recording/i }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});
