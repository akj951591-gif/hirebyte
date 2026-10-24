import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/api/client';
import { RecruiterAuthProvider } from '@/features/auth';
import { RecruiterLoginPage } from '@/pages/recruiter/RecruiterLoginPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/recruiter/login']}>
      <RecruiterAuthProvider>
        <Routes>
          <Route path="/recruiter/login" element={<RecruiterLoginPage />} />
          <Route path="/recruiter" element={<p>Recruiter home</p>} />
        </Routes>
      </RecruiterAuthProvider>
    </MemoryRouter>,
  );
}

async function signIn(email: string, password: string) {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText(/work email/i), email);
  if (password) await user.type(screen.getByLabelText(/^password/i), password);
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('RecruiterLoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api.auth, 'me').mockRejectedValue(new ApiError('UNAUTHENTICATED', 'no session', 401));
  });

  it('validates the form before calling the API', async () => {
    const login = vi.spyOn(api.auth, 'recruiterLogin');
    renderPage();
    await signIn('not-an-email', '');
    expect(await screen.findByText(/valid work email/i)).toBeInTheDocument();
    expect(screen.getByText(/enter your password/i)).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('shows a generic message for wrong credentials and clears the password', async () => {
    vi.spyOn(api.auth, 'recruiterLogin').mockRejectedValue(new ApiError('INVALID_CREDENTIALS', 'x', 401));
    renderPage();
    await signIn('someone@example.test', 'wrong-password');
    expect(await screen.findByText(/email or password is incorrect/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toHaveValue('');
  });

  it('shows the rate-limited state', async () => {
    vi.spyOn(api.auth, 'recruiterLogin').mockRejectedValue(new ApiError('RATE_LIMITED', 'x', 429));
    renderPage();
    await signIn('someone@example.test', 'pw');
    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });

  it('labels password reset as unavailable instead of faking it', async () => {
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: /forgot password/i }));
    expect(screen.getByText(/password reset is not available yet/i)).toBeInTheDocument();
  });

  it('goes to the dashboard after signing in', async () => {
    vi.spyOn(api.auth, 'recruiterLogin').mockResolvedValue({
      user: { id: 'u1', email: 'someone@example.test', name: 'Some One', role: 'RECRUITER' },
    });
    renderPage();
    await signIn('someone@example.test', 'right-password');
    expect(await screen.findByText('Recruiter home')).toBeInTheDocument();
  });
});
