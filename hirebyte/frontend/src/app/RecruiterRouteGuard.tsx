import { Navigate, useLocation } from 'react-router-dom';
import { useRecruiterAuth } from '@/features/auth';
import { ErrorState, LoadingState } from '@/components/PageState';
import { RecruiterLayout } from './RecruiterLayout';

/** UX guard only — every recruiter API call is authorized by the server (PRD §2.2). */
export function RecruiterRouteGuard() {
  const { state, refresh } = useRecruiterAuth();
  const location = useLocation();

  if (state.status === 'loading') return <LoadingState label="Checking your session…" />;

  if (state.status === 'anonymous') {
    return <Navigate to="/recruiter/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState
          message={state.error.message}
          code={state.error.code}
          requestId={state.error.requestId}
          onRetry={() => void refresh()}
        />
      </div>
    );
  }

  return <RecruiterLayout user={state.user} />;
}
