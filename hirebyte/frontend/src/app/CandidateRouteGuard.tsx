import { useCallback, useEffect } from 'react';
import { Navigate, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { api, type CandidateSessionView } from '@/api/client';
import { useAsync } from '@/api/client/useAsync';
import { candidatePathFor, useCandidateSession } from '@/features/auth';
import { ErrorState, LoadingState } from '@/components/PageState';
import { CandidateLayout } from './CandidateLayout';

export interface CandidateOutletContext {
  session: CandidateSessionView;
  setSession: (updater: (current: CandidateSessionView) => CandidateSessionView) => void;
  reloadSession: () => Promise<void>;
}

const SESSION_GONE = new Set(['SESSION_EXPIRED', 'UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_LOCKED']);

/**
 * UX guard for candidate pages: needs a candidate session, loads the candidate-safe session view,
 * and keeps the candidate on the page that matches the backend state (e.g. after a refresh).
 * The API still authorizes every request.
 */
export function CandidateRouteGuard() {
  const { sessionId, forget } = useCandidateSession();
  const { pathname } = useLocation();
  const { data: session, error, loading, reload, setData } = useAsync(
    (signal) => (sessionId ? api.candidate.getSession(sessionId, signal) : Promise.resolve(undefined)),
    [sessionId],
  );

  // Stable callbacks so pages can list them as effect dependencies.
  const setSession = useCallback<CandidateOutletContext['setSession']>(
    (updater) => setData((current) => updater(current as CandidateSessionView)),
    [setData],
  );
  const reloadSession = useCallback(() => reload({ silent: true }), [reload]);

  const sessionGone = error && SESSION_GONE.has(error.code);
  useEffect(() => {
    if (sessionGone) forget();
  }, [sessionGone, forget]);

  if (!sessionId || sessionGone) {
    return <Navigate to="/candidate/login" replace state={{ reason: sessionGone ? error?.code : undefined }} />;
  }

  if (loading && !session) {
    return (
      <CandidateLayout>
        <LoadingState label="Loading your interview…" />
      </CandidateLayout>
    );
  }

  if (error || !session) {
    return (
      <CandidateLayout>
        <div className="card mx-auto max-w-xl">
          <ErrorState
            message={error?.message ?? 'We could not load your interview.'}
            code={error?.code}
            requestId={error?.requestId}
            onRetry={() => void reload()}
          />
        </div>
      </CandidateLayout>
    );
  }

  const expected = candidatePathFor(session.status, session.consent !== null);
  const allowed = expected === '/candidate/device-check' ? ['/candidate/lobby', '/candidate/device-check'] : [expected];
  if (!allowed.includes(pathname)) return <Navigate to={expected} replace />;

  const context: CandidateOutletContext = { session, setSession, reloadSession };

  return (
    <CandidateLayout session={session}>
      <Outlet context={context} />
    </CandidateLayout>
  );
}

export function useCandidateOutlet(): CandidateOutletContext {
  return useOutletContext<CandidateOutletContext>();
}
