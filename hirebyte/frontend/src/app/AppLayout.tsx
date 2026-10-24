import { Link, Outlet, ScrollRestoration, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { FixtureBanner } from '@/components/FixtureBanner';
import { Logo } from '@/components/Logo';
import { buttonClasses } from '@/components/Button';
import { ErrorState } from '@/components/PageState';

export function AppLayout() {
  return (
    <div className="flex min-h-full flex-col">
      <FixtureBanner />
      <Outlet />
      <ScrollRestoration />
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-20 text-center">
      <Logo />
      <Compass className="h-10 w-10 text-ink-subtle" aria-hidden />
      <div>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-ink-muted">The link may be wrong or the page may have moved.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Link to="/candidate/login" className={buttonClasses('primary')}>
          Candidate sign in
        </Link>
        <Link to="/recruiter/login" className={buttonClasses('secondary')}>
          Recruiter sign in
        </Link>
      </div>
    </div>
  );
}

export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred.';
  return (
    <div className="flex min-h-full flex-col items-center justify-center">
      <ErrorState
        title="This page crashed"
        message={message}
        onRetry={() => window.location.reload()}
        action={
          <a href="/" className={buttonClasses('ghost')}>
            Go home
          </a>
        }
      />
    </div>
  );
}
