import { useState, type FormEvent } from 'react';
import type { CreateInterviewRequest, Difficulty, ExperienceLevel, InterviewDetail, QuestionCategory, SecondaryCameraPolicy } from '@/api/client';
import { toApiError } from '@/api/client/useAsync';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { FormField } from '@/components/FormField';
import { humanize } from '@/utils/format';

const categories: QuestionCategory[] = ['TECHNICAL', 'BEHAVIORAL', 'SITUATIONAL', 'RESUME', 'SYSTEM_DESIGN'];
const difficulties: Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];
const levels: ExperienceLevel[] = ['INTERN', 'JUNIOR', 'MID', 'SENIOR', 'LEAD'];
const cameraPolicies: Array<{ value: SecondaryCameraPolicy; label: string }> = [
  { value: 'OFF', label: 'Off — laptop camera only' },
  { value: 'OPTIONAL', label: 'Optional phone camera' },
  { value: 'REQUIRED', label: 'Required phone camera' },
];

type FieldErrors = Partial<Record<'jobTitle' | 'jobDescription' | 'candidateName' | 'candidateEmail' | 'questionCount' | 'durationMinutes' | 'categories', string>>;

/**
 * Role, candidate and interview settings. Creates a new interview, or edits a draft when `initial`
 * is given (the form starts from the saved values).
 */
export function InterviewDetailsForm({
  onSubmit,
  initial,
  submitLabel = 'Create interview and continue',
  onCancel,
}: {
  onSubmit: (request: CreateInterviewRequest) => Promise<void>;
  initial?: InterviewDetail;
  submitLabel?: string;
  onCancel?: () => void;
}) {
  const saved = initial?.config;
  const [candidateName, setCandidateName] = useState(initial?.candidateName ?? '');
  const [candidateEmail, setCandidateEmail] = useState(initial?.candidateEmail ?? '');
  const [jobTitle, setJobTitle] = useState(initial?.jobTitle ?? '');
  const [jobDescription, setJobDescription] = useState(initial?.jobDescription ?? '');
  const [skills, setSkills] = useState(initial?.requiredSkills.join(', ') ?? '');
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>(saved?.experienceLevel ?? 'MID');
  const [difficulty, setDifficulty] = useState<Difficulty>(saved?.difficulty ?? 'MEDIUM');
  const [durationMinutes, setDurationMinutes] = useState(String(saved?.durationMinutes ?? 30));
  const [questionCount, setQuestionCount] = useState(saved ? String(saved.questionCount) : '');
  const [selectedCategories, setSelectedCategories] = useState<QuestionCategory[]>(saved?.categories ?? ['TECHNICAL', 'BEHAVIORAL']);
  const [allowSkip, setAllowSkip] = useState(saved?.allowSkip ?? true);
  const [allowFollowUps, setAllowFollowUps] = useState(saved?.allowFollowUps ?? false);
  const [maxFollowUps, setMaxFollowUps] = useState(String(saved?.maxFollowUps || 1));
  const [secondaryCamera, setSecondaryCamera] = useState<SecondaryCameraPolicy>(saved?.secondaryCamera ?? 'OPTIONAL');
  const [recordingEnabled, setRecordingEnabled] = useState(saved?.recordingEnabled ?? true);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleCategory = (c: QuestionCategory) =>
    setSelectedCategories((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  const validate = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!candidateName.trim()) e.candidateName = 'Enter the candidate’s name.';
    if (!/^\S+@\S+\.\S+$/.test(candidateEmail.trim())) e.candidateEmail = 'Enter a valid email address.';
    if (!jobTitle.trim()) e.jobTitle = 'Enter the job title.';
    if (jobDescription.trim().length < 30) e.jobDescription = 'Paste the job description (at least a few sentences).';
    const duration = Number(durationMinutes);
    if (!Number.isInteger(duration) || duration < 5 || duration > 120) e.durationMinutes = 'Use a whole number between 5 and 120.';
    if (questionCount) {
      const count = Number(questionCount);
      if (!Number.isInteger(count) || count < 1 || count > 30) e.questionCount = 'Use a whole number between 1 and 30, or leave blank for 10.';
    }
    if (selectedCategories.length === 0) e.categories = 'Pick at least one question category.';
    return e;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const e = validate();
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length) return;
    setSubmitting(true);
    try {
      await onSubmit({
        candidateName: candidateName.trim(),
        candidateEmail: candidateEmail.trim(),
        jobTitle: jobTitle.trim(),
        jobDescription: jobDescription.trim(),
        requiredSkills: skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        config: {
          // Omitted count lets the backend apply its default of 10 (PRD §19).
          ...(questionCount ? { questionCount: Number(questionCount) } : {}),
          durationMinutes: Number(durationMinutes),
          difficulty,
          experienceLevel,
          categories: selectedCategories,
          allowSkip,
          allowFollowUps,
          maxFollowUps: allowFollowUps ? Number(maxFollowUps) || 1 : 0,
          secondaryCamera,
          recordingEnabled,
        },
      });
    } catch (err) {
      const error = toApiError(err);
      const fields = (error.details?.fields ?? {}) as FieldErrors;
      setErrors(fields);
      setFormError(error.message);
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-8">
      {formError && <Alert tone="danger">{formError}</Alert>}

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-muted">Candidate</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="candidateName" label="Full name" required error={errors.candidateName}>
            <input className="input" value={candidateName} onChange={(e) => setCandidateName(e.target.value)} autoComplete="off" />
          </FormField>
          <FormField id="candidateEmail" label="Email" required error={errors.candidateEmail}>
            <input type="email" className="input" value={candidateEmail} onChange={(e) => setCandidateEmail(e.target.value)} autoComplete="off" />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-muted">Role</legend>
        <FormField id="jobTitle" label="Job title" required error={errors.jobTitle}>
          <input className="input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Software Engineer" />
        </FormField>
        <FormField id="jobDescription" label="Job description" required error={errors.jobDescription}>
          <textarea
            className="input min-h-[160px] resize-y"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Paste the responsibilities and requirements for the role."
          />
        </FormField>
        <FormField id="skills" label="Required skills" hint="Separate skills with commas, e.g. React, TypeScript, REST APIs">
          <input className="input" value={skills} onChange={(e) => setSkills(e.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="experienceLevel" label="Experience level">
            <select className="input" value={experienceLevel} onChange={(e) => setExperienceLevel(e.target.value as ExperienceLevel)}>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {humanize(l)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="difficulty" label="Difficulty">
            <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
              {difficulties.map((d) => (
                <option key={d} value={d}>
                  {humanize(d)}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-muted">Interview settings</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="questionCount" label="Number of questions" hint="Leave blank to use the default of 10." error={errors.questionCount}>
            <input type="number" min={1} max={30} className="input" value={questionCount} onChange={(e) => setQuestionCount(e.target.value)} placeholder="10" />
          </FormField>
          <FormField id="durationMinutes" label="Duration (minutes)" required error={errors.durationMinutes}>
            <input type="number" min={5} max={120} className="input" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
          </FormField>
        </div>

        <div>
          <p className="text-sm font-medium text-ink" id="categories-label">
            Question categories
          </p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="categories-label">
            {categories.map((c) => {
              const active = selectedCategories.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleCategory(c)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    active ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line text-ink-muted hover:bg-surface-muted'
                  }`}
                >
                  {humanize(c)}
                </button>
              );
            })}
          </div>
          {errors.categories && (
            <p className="mt-1.5 text-xs font-medium text-danger" role="alert">
              {errors.categories}
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-3 rounded border border-line p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--hb-brand))]" checked={allowSkip} onChange={(e) => setAllowSkip(e.target.checked)} />
            <span>
              <span className="font-medium text-ink">Allow skipping</span>
              <span className="block text-xs text-ink-muted">Skipped questions are recorded as unanswered.</span>
            </span>
          </label>
          <div className="rounded border border-line p-3 text-sm">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[rgb(var(--hb-brand))]"
                checked={allowFollowUps}
                onChange={(e) => setAllowFollowUps(e.target.checked)}
              />
              <span>
                <span className="font-medium text-ink">AI follow-up questions</span>
                <span className="block text-xs text-ink-muted">The backend enforces the limit.</span>
              </span>
            </label>
            {allowFollowUps && (
              <label className="mt-2 flex items-center gap-2 pl-7 text-xs text-ink-muted">
                Max per question
                <input type="number" min={1} max={3} className="input w-16 py-1" value={maxFollowUps} onChange={(e) => setMaxFollowUps(e.target.value)} />
              </label>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="secondaryCamera" label="Secondary (phone) camera">
            <select className="input" value={secondaryCamera} onChange={(e) => setSecondaryCamera(e.target.value as SecondaryCameraPolicy)}>
              {cameraPolicies.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </FormField>
          <label className="flex items-start gap-3 rounded border border-line p-3 text-sm sm:mt-6">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--hb-brand))]"
              checked={recordingEnabled}
              onChange={(e) => setRecordingEnabled(e.target.checked)}
            />
            <span>
              <span className="font-medium text-ink">Request recording</span>
              <span className="block text-xs text-ink-muted">
                Only happens if recording is enabled on the server and the candidate consents.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-6 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button variant="secondary" size="lg" onClick={onCancel} disabled={submitting}>
            Discard changes
          </Button>
        )}
        <Button type="submit" size="lg" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
