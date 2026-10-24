import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type InterviewSummary } from '@/api/client';
import { useAsync } from '@/api/client/useAsync';
import { ReportSection } from '@/components/ReportSection';
import { ErrorState, LoadingState } from '@/components/PageState';

/** Below this many scored interviews a comparison chart would mislead, so only counts are shown. */
const MIN_SCORED_FOR_CHART = 3;

function tokenColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--hb-${name}`).trim();
  return value ? `rgb(${value})` : fallback;
}

const funnelStages: Array<{ label: string; match: (i: InterviewSummary) => boolean }> = [
  { label: 'Set up', match: (i) => i.status !== 'DRAFT' && i.status !== 'CANCELLED' },
  { label: 'Started', match: (i) => i.startedAt !== null },
  { label: 'Completed', match: (i) => ['COMPLETED', 'EVALUATING', 'EVALUATED', 'EVALUATION_FAILED', 'REVIEWED'].includes(i.status) },
  { label: 'Evaluated', match: (i) => ['EVALUATED', 'REVIEWED'].includes(i.status) },
  { label: 'Reviewed', match: (i) => i.status === 'REVIEWED' },
];

/** Completion statistics and per-role score summaries (PRD §7.2 Analytics). Loaded lazily (Recharts). */
export default function InterviewAnalytics() {
  const { data, error, loading, reload } = useAsync((signal) => api.interviews.list({}, signal), []);
  const brand = useMemo(() => tokenColor('brand', '#1e5a8a'), []);
  const accent = useMemo(() => tokenColor('accent', '#2bb3a3'), []);
  const ink = useMemo(() => tokenColor('ink-muted', '#4b5563'), []);
  const grid = useMemo(() => tokenColor('line', '#dee4ec'), []);

  const items = data?.items ?? [];
  const funnel = funnelStages.map((stage) => ({ stage: stage.label, count: items.filter(stage.match).length }));
  const scored = items.filter((i) => i.overallScore !== null);
  const byRole = Object.values(
    scored.reduce<Record<string, { role: string; total: number; n: number }>>((acc, i) => {
      const entry = (acc[i.jobTitle] ??= { role: i.jobTitle, total: 0, n: 0 });
      entry.total += i.overallScore as number;
      entry.n += 1;
      return acc;
    }, {}),
  )
    .map((r) => ({ role: r.role, average: Math.round((r.total / r.n) * 10) / 10, n: r.n }))
    .sort((a, b) => b.average - a.average);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ReportSection title="Completion" description="How far interviews have progressed.">
        {loading && !data ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error.message} code={error.code} onRetry={() => void reload()} />
        ) : items.length < MIN_SCORED_FOR_CHART ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {funnel.map((f) => (
              <div key={f.stage} className="rounded bg-surface-muted p-3">
                <dt className="text-xs text-ink-muted">{f.stage}</dt>
                <dd className="text-xl font-semibold text-ink">{f.count}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="h-64" role="img" aria-label={`Completion: ${funnel.map((f) => `${f.stage} ${f.count}`).join(', ')}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnel} margin={{ top: 20, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid vertical={false} stroke={grid} />
                <XAxis dataKey="stage" tick={{ fill: ink, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: ink, fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: grid, opacity: 0.4 }} />
                <Bar dataKey="count" name="Interviews" fill={brand} radius={[4, 4, 0, 0]} maxBarSize={48}>
                  <LabelList dataKey="count" position="top" fill={ink} fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ReportSection>

      <ReportSection title="Average score by role" description="Job-related rubric scores out of 10, including reviewer overrides.">
        {loading && !data ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error.message} code={error.code} onRetry={() => void reload()} />
        ) : scored.length < MIN_SCORED_FOR_CHART ? (
          <p className="py-8 text-center text-sm text-ink-muted">
            {scored.length === 0
              ? 'No interviews have been scored yet.'
              : `Only ${scored.length} scored interview${scored.length === 1 ? '' : 's'} so far. A comparison appears once there are at least ${MIN_SCORED_FOR_CHART}.`}
          </p>
        ) : (
          <>
            <div className="h-64" role="img" aria-label={`Average scores: ${byRole.map((r) => `${r.role} ${r.average} from ${r.n}`).join('; ')}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byRole} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 8 }}>
                  <CartesianGrid horizontal={false} stroke={grid} />
                  <XAxis type="number" domain={[0, 10]} tick={{ fill: ink, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="role" width={150} tick={{ fill: ink, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: grid, opacity: 0.4 }} formatter={(v, _n, p) => [`${v} / 10 (n = ${(p.payload as { n: number }).n})`, 'Average']} />
                  <Bar dataKey="average" fill={accent} radius={[0, 4, 4, 0]} maxBarSize={28}>
                    <LabelList dataKey="average" position="right" fill={ink} fontSize={12} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-ink-subtle">
              Small samples: {byRole.map((r) => `${r.role} (n = ${r.n})`).join(', ')}. Compare candidates for the same role only.
            </p>
          </>
        )}
      </ReportSection>
    </div>
  );
}
