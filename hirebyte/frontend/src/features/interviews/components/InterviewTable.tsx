import type { ReactNode } from 'react';
import type { InterviewStatus, InterviewSummary } from '@/api/client';
import { DataTable, type Column } from '@/components/DataTable';
import { FilterBar } from '@/components/FilterBar';
import { RecordingStatusBadge } from '@/features/recordings';
import { formatRelative, formatScore } from '@/utils/format';
import { InterviewActions } from './InterviewActions';
import { InterviewStatusBadge, filterableStatuses, interviewStatusMeta } from './InterviewStatusBadge';

const columns: Column<InterviewSummary>[] = [
  {
    key: 'candidate',
    header: 'Candidate',
    render: (i) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">{i.candidateName}</p>
        <p className="truncate text-xs text-ink-muted">{i.candidateEmail}</p>
      </div>
    ),
  },
  { key: 'role', header: 'Role', render: (i) => <span className="text-ink">{i.jobTitle}</span> },
  { key: 'status', header: 'Status', render: (i) => <InterviewStatusBadge status={i.status} /> },
  {
    key: 'score',
    header: 'Score',
    hideOnMobile: true,
    render: (i) => <span className="whitespace-nowrap tabular-nums text-ink-muted">{formatScore(i.overallScore, i.maxScore)}</span>,
  },
  { key: 'recording', header: 'Recording', hideOnMobile: true, render: (i) => <RecordingStatusBadge status={i.recordingStatus} /> },
  {
    key: 'created',
    header: 'Created',
    hideOnMobile: true,
    render: (i) => <span className="whitespace-nowrap text-ink-muted">{formatRelative(i.createdAt)}</span>,
  },
  { key: 'action', header: <span className="sr-only">Action</span>, className: 'text-right', render: (i) => <InterviewActions interview={i} /> },
];

export function InterviewTable({ rows, empty }: { rows: InterviewSummary[]; empty?: ReactNode }) {
  return <DataTable caption="Interviews" columns={columns} rows={rows} rowKey={(i) => i.id} empty={empty} />;
}

export function InterviewFilters({
  search,
  onSearchChange,
  status,
  onStatusChange,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  status: InterviewStatus | '';
  onStatusChange: (v: InterviewStatus | '') => void;
}) {
  return (
    <FilterBar search={search} onSearchChange={onSearchChange} searchPlaceholder="Search candidate, email or role" searchLabel="Search interviews">
      <select
        aria-label="Filter by status"
        className="input w-auto min-w-[170px]"
        value={status}
        onChange={(e) => onStatusChange(e.target.value as InterviewStatus | '')}
      >
        <option value="">All statuses</option>
        {filterableStatuses.map((s) => (
          <option key={s} value={s}>
            {interviewStatusMeta[s].label}
          </option>
        ))}
      </select>
    </FilterBar>
  );
}
