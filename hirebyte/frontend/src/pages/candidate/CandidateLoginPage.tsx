import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { candidatePathFor, useCandidateSession, AuthShell } from '@/features/auth';
import { toApiError } from '@/api/client/useAsync';
import { Alert, type AlertTone } from '@/components/Alert';
import { Button, buttonClasses } from '@/components/Button';
import { FormField } from '@/components/FormField';
import { featureFlags } from '@/config/featureFlags';

interface LoginProblem {
  tone: AlertTone;
  title: string;
  message: string;
  requestId?: string;
}

/** Maps candidate access errors to the states required by PRD §2.1. */
function problemFor(code: string, message: string, requestId?: string): LoginProblem {
  switch (code) {
    case 'INVITATION_INVALID':
      return {
        tone: 'danger',
        title: 'Code not recognised',
        message: 'Check the invitation code and access code in your invitation email and try again.',
      };
    case 'INVITATION_EXPIRED':
      return {
        tone: 'warning',
        title: 'Invitation expired',
        message: 'This invitation is no longer valid. Please ask the recruiter to send you a new one.',
      };
    case 'INTERVIEW_COMPLETED':
      return {
        tone: 'info',
        title: 'Interview already completed',
        message: 'You have already submitted this interview. There is nothing more you need to do.',
      };
    case 'SESSION_LOCKED':
      return {
        tone: 'warning',
        title: 'Session locked',
        message: 'This interview session has been locked. Please contact the recruiter to unlock it.',
      };
    case 'RATE_LIMITED':
      return {
        tone: 'warning',
        title: 'Too many attempts',
        message: 'Please wait a few minutes before trying again.',
      };
    case 'VALIDATION_ERROR':
      return { tone: 'danger', title: 'Check your details', message };
    default:
      return {
        tone: 'danger',
        title: 'We could not reach the interview service',
        message: 'This is a problem on our side, not with your code. Please try again in a moment.',
        requestId,
      };
  }
}

const expiredNotice: Record<string, string> = {
  SESSION_EXPIRED: 'Your interview session expired. Sign in again with your invitation details to continue.',
  SESSION_LOCKED: 'Your interview session was locked. Please contact the recruiter.',
  UNAUTHENTICATED: 'Please sign in again to continue your interview.',
  FORBIDDEN: 'Please sign in again to continue your interview.',
};

export function CandidateLoginPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { sessionId, signIn } = useCandidateSession();

  const [invitationCode, setInvitationCode] = useState(() => (params.get('code') ?? '').toUpperCase());
  const [accessCode, setAccessCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ invitationCode?: string; accessCode?: string }>({});
  const [problem, setProblem] = useState<LoginProblem | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reason = (location.state as { reason?: string } | null)?.reason;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!invitationCode.trim()) errors.invitationCode = 'Enter the invitation code from your email.';
    if (!accessCode.trim()) errors.accessCode = 'Enter your access code.';
    setFieldErrors(errors);
    setProblem(null);
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    try {
      const session = await signIn(invitationCode.trim().toUpperCase(), accessCode.trim());
      navigate(candidatePathFor(session.status, session.consent !== null), { replace: true });
    } catch (err) {
      const error = toApiError(err);
      setProblem(problemFor(error.code, error.message, error.requestId));
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Join your interview"
      subtitle="Enter the invitation code and access code from your interview invitation email."
    >
      {reason && expiredNotice[reason] && !problem && (
        <Alert tone="warning" className="mb-5">
          {expiredNotice[reason]}
        </Alert>
      )}

      {sessionId && !reason && (
        <Alert
          tone="info"
          className="mb-5"
          title="You already have an interview open"
          action={
            <Link to="/candidate/lobby" className={buttonClasses('secondary', 'sm')}>
              Continue where you left off
            </Link>
          }
        />
      )}

      {problem && (
        <Alert tone={problem.tone} title={problem.title} className="mb-5">
          {problem.message}
          {problem.requestId && <span className="mt-1 block font-mono text-xs text-ink-subtle">Reference: {problem.requestId}</span>}
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormField id="invitationCode" label="Invitation code" required error={fieldErrors.invitationCode} hint="For example HB-XXXX-XXXX">
          <input
            className="input font-mono uppercase tracking-wide"
            value={invitationCode}
            onChange={(e) => setInvitationCode(e.target.value.toUpperCase())}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={submitting}
          />
        </FormField>

        <FormField id="accessCode" label="Access code" required error={fieldErrors.accessCode}>
          <input
            className="input font-mono tracking-widest"
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode="text"
            spellCheck={false}
            disabled={submitting}
          />
        </FormField>

        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          {submitting ? 'Checking your invitation…' : 'Continue'}
          {!submitting && <ArrowRight className="h-4 w-4" aria-hidden />}
        </Button>
      </form>

      <p className="mt-6 text-xs leading-relaxed text-ink-muted">
        You do not need an account or password. Your access is limited to this one interview and expires
        automatically. Having trouble? Reply to your invitation email to reach the recruiter.
      </p>

      {featureFlags.useFixtures && (
        <p className="mt-4 rounded border border-dashed border-warning/50 bg-warning-soft/40 p-3 text-xs text-ink-muted">
          Fixture mode: demo invitation codes for every login state are listed in <code>frontend/README.md</code>.
        </p>
      )}
    </AuthShell>
  );
}
