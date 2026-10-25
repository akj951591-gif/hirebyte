import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, UserPlus } from 'lucide-react';
import { AuthShell, useRecruiterAuth } from '@/features/auth';
import { toApiError } from '@/api/client/useAsync';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { FormField } from '@/components/FormField';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const MIN_PASSWORD_LENGTH = 12;

type FieldName = 'name' | 'email' | 'password' | 'confirm';
type FieldErrors = Partial<Record<FieldName, string>>;

interface Problem {
  title: string;
  message: string;
  requestId?: string;
}

/** A password input with a show/hide toggle. FormField cannot wrap it: the toggle needs its own wrapper. */
function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete,
  disabled,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  autoComplete: string;
  disabled: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        <span className="ml-0.5 text-danger" aria-hidden>
          *
        </span>
      </label>
      <div className="relative">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          className={`input pr-10 ${error ? 'input-invalid' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          aria-required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-subtle hover:text-ink"
          aria-label={shown ? `Hide ${String(label).toLowerCase()}` : `Show ${String(label).toLowerCase()}`}
          aria-pressed={shown}
        >
          {shown ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Self-service sign-up for recruiters. Creating the account also signs the recruiter in. */
export function RecruiterRegisterPage() {
  const { state, register } = useRecruiterAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (state.status === 'authenticated' && !submitting) return <Navigate to="/recruiter" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errors: FieldErrors = {};
    if (name.trim().length < 2) errors.name = 'Enter your full name.';
    if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid work email address.';
    if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (confirm !== password) errors.confirm = 'The two passwords do not match.';
    setFieldErrors(errors);
    setProblem(null);
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    try {
      await register(name.trim(), email.trim(), password);
      navigate('/recruiter', { replace: true });
    } catch (err) {
      const error = toApiError(err);
      setSubmitting(false);
      setPassword('');
      setConfirm('');
      switch (error.code) {
        case 'EMAIL_TAKEN':
          setFieldErrors({ email: 'An account with this email already exists. Sign in instead.' });
          break;
        case 'VALIDATION_ERROR': {
          // The server checks the same rules plus a few more (for example, obvious passwords).
          const fields = (error.details?.fields ?? {}) as Partial<Record<FieldName, string>>;
          setFieldErrors({ name: fields.name, email: fields.email, password: fields.password });
          if (!fields.name && !fields.email && !fields.password) setProblem({ title: 'Check your details', message: error.message });
          break;
        }
        case 'SIGNUP_DISABLED':
          setProblem({ title: 'Sign-up is turned off', message: error.message });
          break;
        case 'RATE_LIMITED':
          setProblem({ title: 'Too many attempts', message: 'Please wait a few minutes before trying again.' });
          break;
        default:
          setProblem({ title: 'We could not create your account', message: 'Something went wrong. Please try again.', requestId: error.requestId });
      }
    }
  };

  return (
    <AuthShell title="Create your recruiter account" subtitle="Set up interviews, invite candidates and review reports.">
      {problem && (
        <Alert tone="danger" title={problem.title} className="mb-5">
          {problem.message}
          {problem.requestId && <span className="mt-1 block font-mono text-xs text-ink-subtle">Reference: {problem.requestId}</span>}
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormField id="name" label="Full name" required error={fieldErrors.name}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" disabled={submitting} />
        </FormField>

        <FormField id="email" label="Work email" required error={fieldErrors.email}>
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" disabled={submitting} />
        </FormField>

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. A few random words work well.`}
          autoComplete="new-password"
          disabled={submitting}
        />

        <PasswordField
          id="confirm"
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          error={fieldErrors.confirm}
          autoComplete="new-password"
          disabled={submitting}
        />

        <Button type="submit" size="lg" className="w-full" loading={submitting} icon={!submitting && <UserPlus className="h-4 w-4" aria-hidden />}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <Link to="/recruiter/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
