import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { AuthShell, useRecruiterAuth } from '@/features/auth';
import { toApiError } from '@/api/client/useAsync';
import { Alert, type AlertTone } from '@/components/Alert';
import { Button } from '@/components/Button';
import { FormField } from '@/components/FormField';
import { featureFlags } from '@/config/featureFlags';
import { appConfig } from '@/config/app.config';

interface LoginProblem {
  tone: AlertTone;
  title: string;
  message: string;
  requestId?: string;
}

function problemFor(code: string, message: string, requestId?: string): LoginProblem {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      // Deliberately generic so the page never reveals whether an email has an account.
      return { tone: 'danger', title: 'Sign-in failed', message: 'Email or password is incorrect.' };
    case 'RATE_LIMITED':
      return { tone: 'warning', title: 'Too many attempts', message: 'For your security, please wait a few minutes before trying again.' };
    case 'ACCOUNT_LOCKED':
      return { tone: 'warning', title: 'Account locked', message: 'Contact your administrator to unlock your account.' };
    case 'VALIDATION_ERROR':
      return { tone: 'danger', title: 'Check your details', message };
    default:
      return {
        tone: 'danger',
        title: 'Service unavailable',
        message: 'We could not reach the sign-in service. Please try again shortly.',
        requestId,
      };
  }
}

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export function RecruiterLoginPage() {
  const { state, login } = useRecruiterAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/recruiter';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [problem, setProblem] = useState<LoginProblem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showResetInfo, setShowResetInfo] = useState(false);

  if (state.status === 'authenticated' && !submitting) return <Navigate to={from} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid work email address.';
    if (!password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    setProblem(null);
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      const error = toApiError(err);
      setProblem(problemFor(error.code, error.message, error.requestId));
      setPassword('');
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Recruiter sign in" subtitle="Sign in to create interviews, monitor sessions and review reports.">
      {problem && (
        <Alert tone={problem.tone} title={problem.title} className="mb-5">
          {problem.message}
          {problem.requestId && <span className="mt-1 block font-mono text-xs text-ink-subtle">Reference: {problem.requestId}</span>}
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormField id="email" label="Work email" required error={fieldErrors.email}>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            disabled={submitting}
          />
        </FormField>

        {/* Not using FormField here: the show/hide toggle needs a wrapper around the input. */}
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-ink">
            Password
            <span className="ml-0.5 text-danger" aria-hidden>
              *
            </span>
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              className={`input pr-10 ${fieldErrors.password ? 'input-invalid' : ''}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              aria-required
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
              disabled={submitting}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-subtle hover:text-ink"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          </div>
          {fieldErrors.password && (
            <p id="password-error" className="text-xs font-medium text-danger" role="alert">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowResetInfo((s) => !s)}
            className="text-sm font-medium text-brand hover:underline"
            aria-expanded={showResetInfo}
          >
            Forgot password?
          </button>
        </div>
        {showResetInfo && !featureFlags.passwordResetAvailable && (
          <Alert tone="info" title="Password reset is not available yet">
            Self-service reset has not been enabled for this prototype. Ask your {appConfig.productName} administrator to reset
            your password.
          </Alert>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={submitting}
          icon={!submitting && <LogIn className="h-4 w-4" aria-hidden />}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        New to {appConfig.productName}?{' '}
        <Link to="/recruiter/register" className="font-medium text-brand hover:underline">
          Create an account
        </Link>
      </p>

      {featureFlags.useFixtures && (
        <p className="mt-6 rounded border border-dashed border-warning/50 bg-warning-soft/40 p-3 text-xs text-ink-muted">
          Fixture mode: the demo recruiter sign-in is listed in <code>frontend/README.md</code>.
        </p>
      )}
    </AuthShell>
  );
}
