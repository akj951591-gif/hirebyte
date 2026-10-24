import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle } from 'lucide-react';
import { PageHeader } from '@/app/RecruiterLayout';
import { InterviewFilters, InterviewTable, useInterviewList } from '@/features/interviews';
import { buttonClasses } from '@/components/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/PageState';

const InterviewAnalytics = lazy(() => import('@/features/reports/InterviewAnalytics'));

/** All interviews with status management, plus analytics (PRD §7.2). */
export function HistoryPage() {
  const { data, error, loading, reload, search, setSearch, status, setStatus, isFiltered } = useInterviewList();

  return (
    <>
      <PageHeader
        title="Interviews"
        description="Every interview you can access, from draft to reviewed."
        actions={
          <Link to="/recruiter/interviews/new" className={buttonClasses('primary')}>
            <PlusCircle className="h-4 w-4" aria-hidden />
            New interview
          </Link>
        }
      />

      <section className="card" aria-label="Interview list">
        <div className="border-b border-line p-5">
          <InterviewFilters search={search} onSearchChange={setSearch} status={status} onStatusChange={setStatus} />
        </div>
        {loading && !data ? (
          <LoadingState label="Loading interviews…" />
        ) : error ? (
          <ErrorState message={error.message} code={error.code} requestId={error.requestId} onRetry={() => void reload()} />
        ) : (
          <>
            <InterviewTable
              rows={data?.items ?? []}
              empty={
                isFiltered ? (
                  <EmptyState title="No matching interviews" message="Try a different search or clear the status filter." />
                ) : (
                  <EmptyState title="No interviews yet" message="Interviews you create appear here." />
                )
              }
            />
            {data && data.items.length > 0 && (
              <p className="border-t border-line px-5 py-3 text-xs text-ink-muted">
                Showing {data.items.length} of {data.stats.total} interviews
              </p>
            )}
          </>
        )}
      </section>

      <h2 className="mb-4 mt-10 text-lg font-semibold text-ink">Analytics</h2>
      <Suspense fallback={<LoadingState label="Loading analytics…" />}>
        <InterviewAnalytics />
      </Suspense>
    </>
  );
}
