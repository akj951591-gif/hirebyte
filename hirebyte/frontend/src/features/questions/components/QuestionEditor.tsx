import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { api, type Difficulty, type Question, type QuestionCategory, type QuestionDraft } from '@/api/client';
import { toApiError } from '@/api/client/useAsync';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { QuestionCard } from '@/components/QuestionCard';
import { EmptyState } from '@/components/PageState';
import { humanize } from '@/utils/format';

const categories: QuestionCategory[] = ['TECHNICAL', 'BEHAVIORAL', 'SITUATIONAL', 'RESUME', 'SYSTEM_DESIGN'];
const difficulties: Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];

interface DraftItem extends QuestionDraft {
  /** Stable React key, also for new questions without a server id. */
  key: string;
}

let localKey = 0;
const toDraft = (q: Question): DraftItem => ({
  key: q.id,
  id: q.id,
  text: q.text,
  category: q.category,
  difficulty: q.difficulty,
  targetSkills: q.targetSkills,
  evaluationCriteria: q.evaluationCriteria,
  expectedAnswerPoints: q.expectedAnswerPoints,
  source: q.source,
});
const toRequest = (i: DraftItem): QuestionDraft => ({
  id: i.id,
  text: i.text.trim(),
  category: i.category,
  difficulty: i.difficulty,
  targetSkills: i.targetSkills,
  evaluationCriteria: i.evaluationCriteria,
  expectedAnswerPoints: i.expectedAnswerPoints,
  source: i.source,
});
const signature = (items: QuestionDraft[]) =>
  JSON.stringify(items.map(({ id, text, category, difficulty }) => [id ?? null, text.trim(), category, difficulty]));

const generationErrors: Record<string, string> = {
  PROVIDER_UNAVAILABLE: 'The question generator is unavailable right now. Try again in a minute, or add questions manually.',
  PROVIDER_TIMEOUT: 'Question generation took too long. Try again, or add questions manually.',
};

export interface QuestionEditorProps {
  interviewId: string;
  questions: Question[];
  defaultCount: number;
  locked: boolean;
  onSaved: (questions: Question[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

/** Generate, preview, edit and reorder questions; the saved order is the interview order (PRD §7.2, §8.2). */
export function QuestionEditor({ interviewId, questions, defaultCount, locked, onSaved, onDirtyChange }: QuestionEditorProps) {
  const [items, setItems] = useState<DraftItem[]>(() => questions.map(toDraft));
  const [savedSignature, setSavedSignature] = useState(() => signature(questions));
  const [count, setCount] = useState(String(defaultCount || 10));
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const dirty = useMemo(() => signature(items) !== savedSignature, [items, savedSignature]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const update = (key: string, patch: Partial<QuestionDraft>) =>
    setItems((cur) => cur.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const move = (index: number, delta: number) =>
    setItems((cur) => {
      const next = [...cur];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });
  const remove = (key: string) => setItems((cur) => cur.filter((i) => i.key !== key));
  const add = () => {
    localKey += 1;
    const key = `new-${localKey}`;
    setItems((cur) => [
      ...cur,
      {
        key,
        text: '',
        category: 'TECHNICAL',
        difficulty: 'MEDIUM',
        targetSkills: [],
        evaluationCriteria: [],
        expectedAnswerPoints: [],
        source: 'RECRUITER',
      },
    ]);
    setExpanded(null);
  };

  const generate = async () => {
    setConfirmRegenerate(false);
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      setError('Choose between 1 and 30 questions.');
      return;
    }
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const { questions: generated } = await api.interviews.generateQuestions(interviewId, { count: n });
      // Generated questions are a proposal: they count as unsaved until the recruiter approves them with Save.
      setItems(generated.map(toDraft));
      setNotice(`Generated ${generated.length} questions. Review and edit them, then save to approve.`);
    } catch (err) {
      const apiError = toApiError(err);
      setError(generationErrors[apiError.code] ?? apiError.message);
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    setError(null);
    setNotice(null);
    const cleaned = items.map(toRequest);
    if (cleaned.length === 0) return setError('Add at least one question.');
    if (cleaned.some((i) => !i.text)) return setError('Some questions are empty. Fill them in or remove them.');
    const lower = cleaned.map((i) => i.text.toLowerCase());
    if (new Set(lower).size !== lower.length) return setError('Two questions are identical. Remove the duplicate before saving.');

    setSaving(true);
    try {
      const { questions: saved } = await api.interviews.updateQuestions(interviewId, { questions: cleaned });
      setItems(saved.map(toDraft));
      setSavedSignature(signature(saved));
      onSaved(saved);
      setNotice('Questions saved.');
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {!locked && (
        <div className="flex flex-wrap items-end gap-3 rounded border border-line bg-surface-muted p-4">
          <label className="text-sm">
            <span className="block font-medium text-ink">Number of questions</span>
            <input
              type="number"
              min={1}
              max={30}
              className="input mt-1 w-24"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              aria-describedby="count-hint"
            />
          </label>
          <Button
            onClick={() => (items.length > 0 ? setConfirmRegenerate(true) : void generate())}
            loading={generating}
            icon={<Sparkles className="h-4 w-4" aria-hidden />}
          >
            {generating ? 'Generating…' : items.length > 0 ? 'Regenerate with AI' : 'Generate with AI'}
          </Button>
          <p id="count-hint" className="w-full text-xs text-ink-muted">
            Uses the job description, skills and resume. Defaults to 10. You can edit, reorder or add your own afterwards.
          </p>
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && !error && <Alert tone="success">{notice}</Alert>}

      {items.length === 0 ? (
        <EmptyState
          title="No questions yet"
          message={locked ? 'This interview has no questions.' : 'Generate questions with AI or add your own.'}
          action={
            !locked && (
              <Button variant="secondary" onClick={add} icon={<Plus className="h-4 w-4" aria-hidden />}>
                Add a question
              </Button>
            )
          }
        />
      ) : (
        <ol className="space-y-3">
          {items.map((item, index) => (
            <li key={item.key}>
              <QuestionCard
                sequence={index + 1}
                tags={[humanize(item.category), humanize(item.difficulty), item.source === 'RECRUITER' ? 'Your question' : 'AI generated']}
                text={
                  locked ? (
                    item.text
                  ) : (
                    <textarea
                      aria-label={`Question ${index + 1} text`}
                      className="input min-h-[72px] resize-y text-base font-normal"
                      value={item.text}
                      onChange={(e) => update(item.key, { text: e.target.value })}
                      placeholder="Write the question as the candidate should hear it."
                    />
                  )
                }
                actions={
                  !locked && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move question ${index + 1} up`}>
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => move(index, 1)}
                        disabled={index === items.length - 1}
                        aria-label={`Move question ${index + 1} down`}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(item.key)} aria-label={`Delete question ${index + 1}`}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </>
                  )
                }
              >
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  {!locked && (
                    <>
                      <select
                        aria-label={`Question ${index + 1} category`}
                        className="input w-auto py-1.5"
                        value={item.category}
                        onChange={(e) => update(item.key, { category: e.target.value as QuestionCategory })}
                      >
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {humanize(c)}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`Question ${index + 1} difficulty`}
                        className="input w-auto py-1.5"
                        value={item.difficulty}
                        onChange={(e) => update(item.key, { difficulty: e.target.value as Difficulty })}
                      >
                        {difficulties.map((d) => (
                          <option key={d} value={d}>
                            {humanize(d)}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {(item.evaluationCriteria.length > 0 || item.expectedAnswerPoints.length > 0) && (
                    <button
                      type="button"
                      onClick={() => setExpanded((k) => (k === item.key ? null : item.key))}
                      aria-expanded={expanded === item.key}
                      className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
                    >
                      Rubric
                      <ChevronDown className={`h-4 w-4 transition-transform ${expanded === item.key ? 'rotate-180' : ''}`} aria-hidden />
                    </button>
                  )}
                </div>
                {expanded === item.key && (
                  <div className="mt-3 grid gap-4 rounded bg-surface-muted p-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="font-medium text-ink">Evaluation criteria</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted">
                        {item.evaluationCriteria.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium text-ink">Expected answer points</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted">
                        {item.expectedAnswerPoints.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </div>
                    {item.targetSkills.length > 0 && (
                      <p className="text-xs text-ink-subtle sm:col-span-2">Target skills: {item.targetSkills.join(', ')}</p>
                    )}
                  </div>
                )}
              </QuestionCard>
            </li>
          ))}
        </ol>
      )}

      {!locked && items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" onClick={add} icon={<Plus className="h-4 w-4" aria-hidden />}>
            Add a question
          </Button>
          <div className="flex items-center gap-3">
            {dirty && <span className="text-xs font-medium text-warning">Unsaved changes</span>}
            <Button onClick={save} loading={saving} disabled={!dirty} icon={<Save className="h-4 w-4" aria-hidden />}>
              Save questions
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmRegenerate}
        title="Replace the current questions?"
        confirmLabel="Regenerate"
        onConfirm={() => void generate()}
        onCancel={() => setConfirmRegenerate(false)}
      >
        Regenerating replaces all questions in this list, including any edits and questions you added.
      </ConfirmDialog>
    </div>
  );
}
