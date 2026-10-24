import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, Printer, RefreshCw, Sparkles } from 'lucide-react';
import { api, type ReviewEvaluationRequest, type ReviewProctoringEventRequest } from '@/api/client';
import { toApiError, useAsync, usePolling } from '@/api/client/useAsync';
import { PageHeader } from '@/app/RecruiterLayout';
import { EvaluationPanel } from '@/features/evaluation';
import { InterviewStatusBadge } from '@/features/interviews';
import { ProctoringTimeline } from '@/features/proctoring';
import { RecordingPlayer } from '@/features/recordings';
import { Alert } from '@/components/Alert';
import { Button, buttonClasses } from '@/components/Button';
import { ErrorState, LoadingState } from '@/components/PageState';
import { ReportSection } from '@/components/ReportSection';
import { featureFlags } from '@/config/featureFlags';
import { formatDateTime, formatDuration, formatScore } from '@/utils/format';

const failureText: Record<string, string> = {
  PROVIDER_TIMEOUT: 'The evaluation provider timed out.',
  PROVIDER_UNAVAILABLE: 'The evaluation provider was unavailable.',
};

/** Evidence-based report with recording, rubric review and observations (PRD §7.2). */
export function ReportPage() {
  const { id = '' } = useParams();
  const report = useAsync((signal) => api.interviews.report(id, signal), [id]);
  const recordings = useAsync((signal) => api.recordings.list(id, signal), [id]);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluateError, setEvaluateError] = useState<string | null>(null);

  const data = report.data;
  usePolling(() => void report.reload({ silent: true }), 3000, data?.evaluationStatus === 'EVALUATING');

  if (report.loading && !data) return <LoadingState label="Loading report…" />;
  if (report.error || !data) {
    return (
      <div className="card">
        <ErrorState
          message={report.error?.message ?? 'Could not load the report.'}
          code={report.error?.code}
          requestId={report.error?.requestId}
          onRetry={() => void report.reload()}
        />
      </div>
    );
  }

  const { interview, overall, items, evaluationStatus } = data;
  const answered = items.filter((i) => i.answer?.status === 'ANSWERED').length;
  const skipped = items.filter((i) => i.answer?.status === 'SKIPPED').length;
  const unanswered = items.length - answered - skipped;
  const overrides = items.filter((i) => i.evaluation?.override).length;
  const canEvaluate = ['COMPLETED', 'EVALUATION_FAILED'].includes(interview.status) || evaluationStatus === 'FAILED';
  const interviewSeconds =
    interview.startedAt && interview.endedAt ? (new Date(interview.endedAt).getTime() - new Date(interview.startedAt).getTime()) / 1000 : null;

  const runEvaluation = async () => {
    setEvaluating(true);
    setEvaluateError(null);
    try {
      await api.interviews.evaluate(interview.id);
      await report.reload({ silent: true });
    } catch (err) {
      setEvaluateError(toApiError(err).message);
    } finally {
      setEvaluating(false);
    }
  };

  const reviewEvaluation = async (evaluationId: string, body: ReviewEvaluationRequest) => {
    await api.evaluations.review(evaluationId, body);
    await report.reload({ silent: true }); // overall score is recomputed by the server
  };

  const reviewEvent = async (eventId: string, body: ReviewProctoringEventRequest) => {
    const updated = await api.proctoring.review(eventId, body);
    report.setData((cur) => ({
      ...cur!,
      proctoringEvents: cur!.proctoringEvents.map((e) => (e.id === updated.id ? updated : e)),
    }));
  };

  return (
    <>
      <Link to="/recruiter/interviews" className="no-print mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Interviews
      </Link>
      <PageHeader
        title={`${interview.candidateName} · ${interview.jobTitle}`}
        description={`Interview ${formatDateTime(interview.startedAt)}${interviewSeconds ? ` · ${formatDuration(interviewSeconds)}` : ''} · ${interview.candidateEmail}`}
        actions={
          <>
            <InterviewStatusBadge status={interview.status} />
            <Button variant="secondary" onClick={() => window.print()} icon={<Printer className="h-4 w-4" aria-hidden />}>
              Print / save PDF
            </Button>
            {featureFlags.serverPdfExport && (
              <a href={api.interviews.exportPdfUrl(interview.id)} className={buttonClasses('secondary')}>
                <Download className="h-4 w-4" aria-hidden />
                Download PDF
              </a>
            )}
          </>
        }
      />

      <div className="space-y-6">
        {evaluationStatus === 'EVALUATING' && (
          <Alert tone="info" title="Evaluation in progress">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Answers are being scored against the rubric. This page updates automatically.
            </span>
          </Alert>
        )}
        {evaluationStatus === 'FAILED' && (
          <Alert
            tone="danger"
            title="Evaluation failed"
            action={
              <Button size="sm" variant="secondary" loading={evaluating} onClick={runEvaluation} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}>
                Retry evaluation
              </Button>
            }
          >
            {failureText[data.evaluationFailureCode ?? ''] ?? 'The evaluation could not be completed.'} All answers are saved; nothing was lost.
          </Alert>
        )}
        {evaluationStatus === 'NOT_STARTED' && (
          <Alert
            tone="info"
            title="Not evaluated yet"
            action={
              canEvaluate ? (
                <Button size="sm" loading={evaluating} onClick={runEvaluation} icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}>
                  Run evaluation
                </Button>
              ) : undefined
            }
          >
            Transcripts are available below. Run the evaluation to score answers against the rubric.
          </Alert>
        )}
        {evaluateError && <Alert tone="danger">{evaluateError}</Alert>}

        <ReportSection title="Summary" description="AI-assisted assessment for human review. It is not a hiring decision.">
          <div className="grid gap-6 md:grid-cols-[200px_1fr]">
            <div className="rounded-lg bg-surface-muted p-4 text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Overall score</p>
              <p className="mt-1 text-4xl font-semibold tabular-nums text-ink">{overall?.score ?? '—'}</p>
              <p className="text-sm text-ink-muted">out of {overall?.maxScore ?? interview.maxScore}</p>
              {overrides > 0 && <p className="mt-2 text-xs text-warning">Includes {overrides} reviewer override{overrides === 1 ? '' : 's'}</p>}
              <dl className="mt-4 grid grid-cols-3 gap-1 text-xs">
                <div>
                  <dt className="text-ink-subtle">Answered</dt>
                  <dd className="font-semibold text-ink">{answered}</dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">Skipped</dt>
                  <dd className="font-semibold text-ink">{skipped}</dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">No answer</dt>
                  <dd className="font-semibold text-ink">{unanswered}</dd>
                </div>
              </dl>
            </div>
            <div className="space-y-4 text-sm">
              {overall ? (
                <>
                  <p className="text-ink">{overall.summary}</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-success">Strengths</h3>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted">
                        {overall.strengths.length ? overall.strengths.map((s) => <li key={s}>{s}</li>) : <li>None noted</li>}
                      </ul>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-warning">Gaps</h3>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted">
                        {overall.gaps.length ? overall.gaps.map((g) => <li key={g}>{g}</li>) : <li>None noted</li>}
                      </ul>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-ink-muted">The overall assessment appears after evaluation.</p>
              )}
              <p className="text-xs text-ink-subtle">Skills assessed: {interview.requiredSkills.join(', ') || '—'}</p>
            </div>
          </div>
        </ReportSection>

        <ReportSection title="Recording" description="Visible only to authorised recruiters.">
          {recordings.loading && !recordings.data ? (
            <LoadingState label="Checking recording…" />
          ) : recordings.error ? (
            <ErrorState message={recordings.error.message} code={recordings.error.code} onRetry={() => void recordings.reload()} />
          ) : recordings.data && recordings.data.items.length > 0 ? (
            <div className="space-y-6">
              {recordings.data.items.map((rec) => (
                <RecordingPlayer key={rec.id} recording={rec} onRefresh={() => void recordings.reload({ silent: true })} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">This interview was not recorded (recording was disabled or the candidate did not consent).</p>
          )}
        </ReportSection>

        <section aria-labelledby="answers-heading">
          <h2 id="answers-heading" className="mb-3 text-lg font-semibold text-ink">
            Questions and answers
          </h2>
          <div className="space-y-4">
            {items.map((item) => (
              <EvaluationPanel key={item.question.id} item={item} total={items.length} onReview={reviewEvaluation} />
            ))}
          </div>
        </section>

        <ReportSection title="Observation timeline" description={`${data.proctoringEvents.length} logged`}>
          <ProctoringTimeline events={data.proctoringEvents} startedAt={interview.startedAt} onReview={reviewEvent} />
        </ReportSection>

        <p className="text-center text-xs text-ink-subtle">
          Report generated {formatDateTime(data.generatedAt)} · Overall score {formatScore(overall?.score ?? null, overall?.maxScore)}
        </p>
      </div>
    </>
  );
}
