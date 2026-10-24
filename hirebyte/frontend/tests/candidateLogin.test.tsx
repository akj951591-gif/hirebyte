import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/api/client';
import { CandidateSessionProvider } from '@/features/auth';
import { CandidateLoginPage } from '@/pages/candidate/CandidateLoginPage';

function renderPage(initial = '/candidate/login') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <CandidateSessionProvider>
        <Routes>
          <Route path="/candidate/login" element={<CandidateLoginPage />} />
          <Route path="/candidate/lobby" element={<p>Lobby page</p>} />
        </Routes>
      </CandidateSessionProvider>
    </MemoryRouter>,
  );
}

async function submit(code: string, access: string) {
  const user = userEvent.setup();
  if (code) await user.type(screen.getByLabelText(/invitation code/i), code);
  if (access) await user.type(screen.getByLabelText(/access code/i), access);
  await user.click(screen.getByRole('button', { name: /continue/i }));
}

describe('CandidateLoginPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('asks for both codes before calling the API', async () => {
    const access = vi.spyOn(api.candidate, 'access');
    renderPage();
    await submit('', '');
    expect(await screen.findByText(/enter the invitation code from your email/i)).toBeInTheDocument();
    expect(screen.getByText(/enter your access code/i)).toBeInTheDocument();
    expect(access).not.toHaveBeenCalled();
  });

  it('prefills the invitation code from the link', () => {
    renderPage('/candidate/login?code=hb-abcd-1234');
    expect(screen.getByLabelText(/invitation code/i)).toHaveValue('HB-ABCD-1234');
  });

  it.each([
    ['INVITATION_INVALID', 401, /code not recognised/i],
    ['INVITATION_EXPIRED', 410, /invitation expired/i],
    ['INTERVIEW_COMPLETED', 409, /already completed/i],
    ['SESSION_LOCKED', 423, /session locked/i],
    ['RATE_LIMITED', 429, /too many attempts/i],
    ['SERVICE_UNAVAILABLE', 503, /could not reach the interview service/i],
  ])('shows the %s state', async (code, status, text) => {
    vi.spyOn(api.candidate, 'access').mockRejectedValue(new ApiError(code, 'server message', status));
    renderPage();
    await submit('HB-TEST-0001', '123456');
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('opens the lobby after a valid code', async () => {
    vi.spyOn(api.candidate, 'access').mockResolvedValue({ sessionId: 'cs_1', expiresAt: new Date().toISOString() });
    vi.spyOn(api.candidate, 'getSession').mockResolvedValue({
      sessionId: 'cs_1',
      interviewId: 'int_1',
      status: 'ONBOARDING',
      candidateName: 'Test',
      jobTitle: 'Engineer',
      companyName: 'Co',
      estimatedDurationMinutes: 20,
      questionCount: 5,
      allowSkip: true,
      instructions: [],
      recording: { enabled: false, required: false, noticeVersion: 'v1', feeds: [], purpose: '', access: '', retention: '' },
      proctoring: { enabled: true, noticeVersion: 'v1', description: '' },
      secondaryCamera: 'OFF',
      consent: null,
      pairing: null,
      expiresAt: new Date().toISOString(),
    });
    renderPage();
    await submit('HB-TEST-0001', '123456');
    expect(await screen.findByText('Lobby page')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('hirebyte.candidateSessionId')).toBe('cs_1');
  });
});
