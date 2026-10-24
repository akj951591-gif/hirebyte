import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, Layers, PlusCircle, Radio } from 'lucide-react';
import { PageHeader } from '@/app/RecruiterLayout';
import { useRecruiterAuth } from '@/features/auth';
import { InterviewFilters, InterviewTable, useInterviewList } from '@/features/interviews';
import { buttonClasses } from '@/components/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/PageState';
import { StatCard } from '@/components/StatCard';

const RECENT_LIMIT = 8;

export function OverviewPage() {
  const { state } = useRecruiterAuth();
  const { data, error, loading, reload, search, setSearch, status, setStatus, isFiltered } = useInterviewList();
  const firstName = state.status === 'authenticated' ? state.user.name.split(' ')[0] : '';
  const stats = data?.stats;

  return (
    <>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : 'Overview'}
        description="Your interviews at a glance."
        actions={
          <Link to="/recruiter/interviews/new" className={buttonClasses('primary')}>
            <PlusCircle className="h-4 w-4" aria-hidden />
            New interview
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total interviews" value={stats?.total ?? '—'} icon={<Layers className="h-5 w-5" aria-hidden />} />
        <StatCard label="In progress" value={stats?.inProgress ?? '—'} icon={<Radio className="h-5 w-5" aria-hidden />} />
        <StatCard label="Completed" value={stats?.completed ?? '—'} icon={<CheckCircle2 className="h-5 w-5" aria-hidden />} />
        <StatCard
          label="Pending review"
          value={stats?.pendingReview ?? '—'}
          icon={<ClipboardCheck className="h-5 w-5" aria-hidden />}
          hint="Completed but not yet reviewed"
        />
      </div>

      <section className="card mt-6" aria-labelledby="recent-heading">
        <div className="flex flex-col gap-4 border-b border-line p-5">
          <div className="flex items-center justify-between">
            <h2 id="recent-heading" className="text-base font-semibold text-ink">
              Recent interviews
            </h2>
            <Link to="/recruiter/interviews" className="text-sm font-medium text-brand hover:underline">
              View all
            </Link>
          </div>
          <InterviewFilters search={search} onSearchChange={setSearch} status={status} onStatusChange={setStatus} />
        </div>

        {loading && !data ? (
          <LoadingState label="Loading interviews…" />
        ) : error ? (
          <ErrorState message={error.message} code={error.code} requestId={error.requestId} onRetry={() => void reload()} />
        ) : (
          <InterviewTable
            rows={(data?.items ?? []).slice(0, RECENT_LIMIT)}
            empty={
              isFiltered ? (
                <EmptyState title="No matching interviews" message="Try a different search or clear the status filter." />
              ) : (
                <EmptyState
                  title="No interviews yet"
                  message="Create your first interview to generate questions and invite a candidate."
                  action={
                    <Link to="/recruiter/interviews/new" className={buttonClasses('primary')}>
                      Create interview
                    </Link>
                  }
                />
              )
            }
          />
        )}
      </section>
    </>
  );
}
