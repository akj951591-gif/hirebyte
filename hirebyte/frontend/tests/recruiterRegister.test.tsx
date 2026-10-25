import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/api/client';
import { RecruiterAuthProvider } from '@/features/auth';
import { RecruiterLoginPage } from '@/pages/recruiter/RecruiterLoginPage';
import { RecruiterRegisterPage } from '@/pages/recruiter/RecruiterRegisterPage';

const PASSWORD = 'a-long-unique-passphrase-2026';

function renderPage(path = '/recruiter/register') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RecruiterAuthProvider>
        <Routes>
          <Route path="/recruiter/register" element={<RecruiterRegisterPage />} />
          <Route path="/recruiter/login" element={<RecruiterLoginPage />} />
          <Route path="/recruiter" element={<p>Recruiter home</p>} />
        </Routes>
      </RecruiterAuthProvider>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(values: { name?: string; email?: string; password?: string; confirm?: string }) {
  const user = userEvent.setup();
  if (values.name) await user.type(screen.getByLabelText(/full name/i), values.name);
  if (values.email) await user.type(screen.getByLabelText(/work email/i), values.email);
  if (values.password) await user.type(screen.getByLabelText(/^password/i), values.password);
  if (values.confirm) await user.type(screen.getByLabelText(/^confirm password/i), values.confirm);
  await user.click(screen.getByRole('button', { name: /create account/i }));
}

describe('RecruiterRegisterPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api.auth, 'me').mockRejectedValue(new ApiError('UNAUTHENTICATED', 'no session', 401));
  });

  it('checks the form before calling the API', async () => {
    const register = vi.spyOn(api.auth, 'recruiterRegister');
    renderPage();
    await fillAndSubmit({ name: 'P', email: 'not-an-email', password: 'short', confirm: 'different' });
    expect(await screen.findByText(/enter your full name/i)).toBeInTheDocument();
    expect(screen.getByText(/valid work email/i)).toBeInTheDocument();
    expect(screen.getByText(/at least 12 characters\.$/i)).toBeInTheDocument();
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('creates the account and lands on the dashboard, already signed in', async () => {
    const register = vi
      .spyOn(api.auth, 'recruiterRegister')
      .mockResolvedValue({ user: { id: 'u1', email: 'priya@example.test', name: 'Priya Sharma', role: 'RECRUITER' } });
    renderPage();
    await fillAndSubmit({ name: '  Priya Sharma ', email: ' priya@example.test ', password: PASSWORD, confirm: PASSWORD });
    expect(await screen.findByText('Recruiter home')).toBeInTheDocument();
    expect(register).toHaveBeenCalledWith({ name: 'Priya Sharma', email: 'priya@example.test', password: PASSWORD });
  });

  it('says the email is taken on the email field and clears both passwords', async () => {
    vi.spyOn(api.auth, 'recruiterRegister').mockRejectedValue(new ApiError('EMAIL_TAKEN', 'x', 409));
    renderPage();
    await fillAndSubmit({ name: 'Priya Sharma', email: 'priya@example.test', password: PASSWORD, confirm: PASSWORD });
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toHaveValue('');
    expect(screen.getByLabelText(/^confirm password/i)).toHaveValue('');
    expect(screen.getByLabelText(/work email/i)).toHaveValue('priya@example.test');
  });

  it('shows the server’s field messages, such as an obvious password', async () => {
    vi.spyOn(api.auth, 'recruiterRegister').mockRejectedValue(
      new ApiError('VALIDATION_ERROR', 'Please fix the highlighted fields.', 400, undefined, { fields: { password: 'Choose a password that is harder to guess.' } }),
    );
    renderPage();
    await fillAndSubmit({ name: 'Priya Sharma', email: 'priya@example.test', password: 'password1234', confirm: 'password1234' });
    expect(await screen.findByText(/harder to guess/i)).toBeInTheDocument();
  });

  it('explains when sign-up is switched off, and when there are too many attempts', async () => {
    const register = vi.spyOn(api.auth, 'recruiterRegister').mockRejectedValueOnce(new ApiError('SIGNUP_DISABLED', 'Creating accounts is turned off.', 403));
    renderPage();
    await fillAndSubmit({ name: 'Priya Sharma', email: 'priya@example.test', password: PASSWORD, confirm: PASSWORD });
    expect(await screen.findByText(/sign-up is turned off/i)).toBeInTheDocument();

    register.mockRejectedValueOnce(new ApiError('RATE_LIMITED', 'x', 429));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^password/i), PASSWORD);
    await user.type(screen.getByLabelText(/^confirm password/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });

  it('does not blame the connection for an unexpected error', async () => {
    vi.spyOn(api.auth, 'recruiterRegister').mockRejectedValue(new ApiError('INTERNAL_ERROR', 'boom', 500, 'req-1'));
    renderPage();
    await fillAndSubmit({ name: 'Priya Sharma', email: 'priya@example.test', password: PASSWORD, confirm: PASSWORD });
    expect(await screen.findByText(/we could not create your account/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not reach/i)).not.toBeInTheDocument();
    expect(screen.getByText(/req-1/)).toBeInTheDocument();
  });

  it('links between sign-in and sign-up', async () => {
    renderPage('/recruiter/login');
    await userEvent.setup().click(screen.getByRole('link', { name: /create an account/i }));
    expect(await screen.findByRole('heading', { name: /create your recruiter account/i })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('link', { name: /^sign in$/i }));
    expect(await screen.findByRole('heading', { name: /recruiter sign in/i })).toBeInTheDocument();
  });
});
