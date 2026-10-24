import { useState, type FormEvent } from 'react';
import { CheckCircle2, PencilLine, Quote, Undo2 } from 'lucide-react';
import type { ReportItem, ReviewEvaluationRequest } from '@/api/client';
import { toApiError } from '@/api/client/useAsync';
import { Button } from '@/components/Button';
import { QuestionCard } from '@/components/QuestionCard';
import { StatusBadge } from '@/components/StatusBadge';
import { cn } from '@/components/cn';
import { formatDateTime, formatDuration, formatScore, humanize } from '@/utils/format';

export interface EvaluationPanelProps {
  item: ReportItem;
  total: number;
  onReview: (evaluationId: string, body: ReviewEvaluationRequest) => Promise<void>;
}

/** One question's transcript, rubric scores, evidence and reviewer override (PRD §7.2, §8.3). */
export function EvaluationPanel({ item, total, onReview }: EvaluationPanelProps) {
  const { question, answer, evaluation } = item;
  const [mode, setMode] = useState<'view' | 'override'>('view');
  const [score, setScore] = useState(String(evaluation?.override?.score ?? evaluation?.score ?? ''));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = async (body: ReviewEvaluationRequest) => {
    if (!evaluation) return;
    setBusy(true);
    setError(null);
    try {
      await onReview(evaluation.id, body);
      setMode('view');
      setReason('');
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const submitOverride = (e: FormEvent) => {
    e.preventDefault();
    if (!evaluation) return;
    const value = Number(score);
    if (score === '' || Number.isNaN(value) || value < 0 || value > evaluation.maxScore) {
      setError(`Enter a score between 0 and ${evaluation.maxScore}.`);
      return;
    }
    if (!reason.trim()) {
      setError('Add a short reason so other reviewers understand the change.');
      return;
    }
    void review({ reviewStatus: 'OVERRIDDEN', score: value, reason: reason.trim() });
  };

  const answerBadge =
    !answer || answer.status === 'UNANSWERED' ? (
      <StatusBadge tone="neutral">Unanswered</StatusBadge>
    ) : answer.status === 'SKIPPED' ? (
      <StatusBadge tone="warning">Skipped</StatusBadge>
    ) : (
      <StatusBadge tone="success">Answered</StatusBadge>
    );

  const effectiveScore = evaluation?.override?.score ?? evaluation?.score ?? null;

  return (
    <QuestionCard
      sequence={question.sequence}
      total={total}
      text={question.text}
      tags={[humanize(question.category), humanize(question.difficulty)]}
      actions={
        evaluation && (
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums text-ink">{formatScore(effectiveScore, evaluation.maxScore)}</p>
            {evaluation.override && <p className="text-xs text-ink-muted">AI: {formatScore(evaluation.score, evaluation.maxScore)}</p>}
          </div>
        )
      }
    >
      <div className="space-y-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            {answerBadge}
            {answer?.durationSeconds ? <span>{formatDuration(answer.durationSeconds)}</span> : null}
            {answer?.inputMode && <span>{answer.inputMode === 'VOICE' ? 'Spoken answer (transcribed)' : 'Typed answer'}</span>}
          </div>
          {answer?.status === 'ANSWERED' && answer.transcript ? (
            <blockquote className="mt-2 whitespace-pre-line rounded border-l-4 border-brand/40 bg-surface-muted px-4 py-3 text-sm leading-relaxed text-ink">
              {answer.transcript}
            </blockquote>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">No answer was given. Unanswered questions are not scored as zero.</p>
          )}
        </div>

        {evaluation ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Rubric</h4>
                <ul className="mt-2 space-y-2">
                  {evaluation.criteria.map((c) => (
                    <li key={c.criterion} className="text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="text-ink">{c.criterion}</span>
                        <span className="shrink-0 tabular-nums text-ink-muted">
                          {c.score}/{c.maxScore}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                        <div className="h-full rounded-full bg-brand" style={{ width: `${(c.score / c.maxScore) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Evidence from the transcript</h4>
                <ul className="mt-2 space-y-2">
                  {evaluation.evidence.map((quote) => (
                    <li key={quote} className="flex gap-2 text-sm italic text-ink-muted">
                      <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                      {quote}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-ink">{evaluation.explanation}</p>
              </div>
            </div>

            {(evaluation.strengths.length > 0 || evaluation.gaps.length > 0) && (
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                {evaluation.strengths.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-success">Strengths</h4>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted">
                      {evaluation.strengths.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {evaluation.gaps.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-warning">Gaps</h4>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted">
                      {evaluation.gaps.map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {evaluation.override && (
              <div className="rounded border border-warning/40 bg-warning-soft/40 px-4 py-3 text-sm">
                <p className="font-medium text-ink">
                  Reviewer override: {formatScore(evaluation.override.score, evaluation.maxScore)} (AI score{' '}
                  {formatScore(evaluation.score, evaluation.maxScore)} kept for reference)
                </p>
                <p className="mt-1 text-ink-muted">“{evaluation.override.reason}”</p>
                <p className="mt-1 text-xs text-ink-subtle">
                  {evaluation.override.reviewerName} · {formatDateTime(evaluation.override.reviewedAt)}
                </p>
              </div>
            )}

            <div className="no-print border-t border-line pt-4">
              {mode === 'view' ? (
                <div className="flex flex-wrap items-center gap-2">
                  {evaluation.reviewStatus === 'AI_ONLY' ? (
                    <StatusBadge tone="neutral">Not reviewed</StatusBadge>
                  ) : evaluation.reviewStatus === 'CONFIRMED' ? (
                    <StatusBadge tone="success">Reviewed — AI score confirmed</StatusBadge>
                  ) : (
                    <StatusBadge tone="warning">Reviewed — score overridden</StatusBadge>
                  )}
                  <div className="ml-auto flex flex-wrap gap-2">
                    {evaluation.reviewStatus !== 'CONFIRMED' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy}
                        onClick={() => void review({ reviewStatus: 'CONFIRMED' })}
                        icon={evaluation.override ? <Undo2 className="h-3.5 w-3.5" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                      >
                        {evaluation.override ? 'Revert to AI score' : 'Confirm AI score'}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setMode('override')} icon={<PencilLine className="h-3.5 w-3.5" aria-hidden />}>
                      {evaluation.override ? 'Edit override' : 'Override score'}
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={submitOverride} className="grid gap-3 sm:grid-cols-[120px_1fr]">
                  <label className="text-sm">
                    <span className="block font-medium text-ink">New score</span>
                    <input
                      type="number"
                      min={0}
                      max={evaluation.maxScore}
                      step={0.5}
                      className="input mt-1"
                      value={score}
                      onChange={(e) => setScore(e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    <span className="block font-medium text-ink">Reason</span>
                    <input
                      className="input mt-1"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="What did the AI assessment miss?"
                      maxLength={500}
                    />
                  </label>
                  <div className="flex gap-2 sm:col-span-2">
                    <Button type="submit" size="sm" loading={busy}>
                      Save override
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setMode('view')} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
              {error && <p className={cn('mt-2 text-xs text-danger')}>{error}</p>}
            </div>
          </>
        ) : answer?.status === 'ANSWERED' ? (
          <p className="text-sm text-ink-muted">This answer has not been evaluated yet.</p>
        ) : null}
      </div>
    </QuestionCard>
  );
}
