import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FileText, PencilLine, Radio, Send } from 'lucide-react';
import { api, type InterviewDetail } from '@/api/client';
import { toApiError, useAsync, usePolling } from '@/api/client/useAsync';
import { PageHeader } from '@/app/RecruiterLayout';
import {
  CancelInterviewButton,
  DeleteDraftButton,
  InterviewDetailsForm,
  InterviewStatusBadge,
  InvitationCard,
} from '@/features/interviews';
import { QuestionEditor } from '@/features/questions';
import { ResumeUpload } from '@/features/resume';
import { Alert } from '@/components/Alert';
import { Button, buttonClasses } from '@/components/Button';
import { ErrorState, LoadingState } from '@/components/PageState';
import { cn } from '@/components/cn';
import { humanize } from '@/utils/format';

export function CreateInterviewPage() {
  const { id } = useParams();
  return id ? <InterviewSetup id={id} /> : <NewInterview />;
}

function NewInterview() {
  const navigate = useNavigate();
  return (
    <>
      <BackLink />
      <PageHeader title="New interview" description="Step 1 of 4 — describe the role and candidate. You can add a resume and questions next." />
      <div className="card p-6">
        <InterviewDetailsForm
          onSubmit={async (request) => {
            const created = await api.interviews.create(request);
            navigate(`/recruiter/interviews/${created.id}/setup`, { replace: true });
          }}
        />
      </div>
    </>
  );
}

function BackLink() {
  return (
    <Link to="/recruiter/interviews" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Interviews
    </Link>
  );
}

function Step({
  number,
  title,
  description,
  done,
  action,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  done?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card" aria-labelledby={`step-${number}`}>
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            done ? 'bg-success-soft text-success' : 'bg-brand-soft text-brand-strong',
          )}
        >
          {done ? <CheckCircle2 className="h-4 w-4" aria-label="Done" /> : number}
        </span>
        <div>
          <h2 id={`step-${number}`} className="font-semibold text-ink">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
        </div>
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function InterviewSetup({ id }: { id: string }) {
  const { data: interview, error, loading, reload, setData } = useAsync((signal) => api.interviews.get(id, signal), [id]);
  const [questionsDirty, setQuestionsDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [readying, setReadying] = useState(false);
  const [readyError, setReadyError] = useState<string | null>(null);

  const extracting = interview?.resume?.extractionStatus === 'PENDING' || interview?.resume?.extractionStatus === 'PROCESSING';
  usePolling(() => void reload({ silent: true }), 3000, Boolean(extracting));

  if (loading && !interview) return <LoadingState label="Loading interview…" />;
  if (error || !interview) {
    return (
      <>
        <BackLink />
        <div className="card">
          <ErrorState
            message={error?.code === 'NOT_FOUND' ? 'This interview does not exist or you do not have access to it.' : (error?.message ?? 'Could not load the interview.')}
            code={error?.code}
            requestId={error?.requestId}
            onRetry={error?.code === 'NOT_FOUND' ? undefined : () => void reload()}
          />
        </div>
      </>
    );
  }

  const patch = (changes: Partial<InterviewDetail>) => setData((cur) => ({ ...(cur as InterviewDetail), ...changes }));
  const isDraft = interview.status === 'DRAFT';
  const isCancelled = interview.status === 'CANCELLED';
  const hasQuestions = interview.questions.length > 0;

  const markReady = async () => {
    setReadying(true);
    setReadyError(null);
    try {
      const result = await api.interviews.markReady(interview.id);
      setData(result.interview);
    } catch (err) {
      setReadyError(toApiError(err).message);
    } finally {
      setReadying(false);
    }
  };

  const { config } = interview;

  return (
    <>
      <BackLink />
      <PageHeader
        title={`${interview.jobTitle} — ${interview.candidateName}`}
        description={
          isDraft
            ? 'Finish setup, then create the candidate invitation.'
            : isCancelled
              ? 'This interview was cancelled. The invitation no longer works.'
              : 'Setup is locked because the invitation has been issued.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <InterviewStatusBadge status={interview.status} />
            <CancelInterviewButton interview={interview} onCancelled={setData} />
            <DeleteDraftButton interview={interview} />
          </div>
        }
      />

      <div className="space-y-6">
        <Step
          number={1}
          title="Role and candidate"
          done={!editing}
          action={
            isDraft && !editing ? (
              <Button variant="secondary" size="sm" icon={<PencilLine className="h-3.5 w-3.5" aria-hidden />} onClick={() => setEditing(true)}>
                Edit details
              </Button>
            ) : undefined
          }
        >
          {editing ? (
            <InterviewDetailsForm
              initial={interview}
              submitLabel="Save changes"
              onCancel={() => setEditing(false)}
              onSubmit={async (request) => {
                setData(await api.interviews.update(interview.id, request));
                setEditing(false);
              }}
            />
          ) : (
            <>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Detail label="Candidate">
                  {interview.candidateName} <span className="text-ink-muted">· {interview.candidateEmail}</span>
                </Detail>
                <Detail label="Skills">{interview.requiredSkills.length ? interview.requiredSkills.join(', ') : '—'}</Detail>
                <Detail label="Level / difficulty">
                  {humanize(config.experienceLevel)} · {humanize(config.difficulty)}
                </Detail>
                <Detail label="Duration">{config.durationMinutes} minutes</Detail>
                <Detail label="Categories">{config.categories.map(humanize).join(', ')}</Detail>
                <Detail label="Options">
                  {[
                    config.allowSkip ? 'Skipping allowed' : 'No skipping',
                    config.allowFollowUps ? `Up to ${config.maxFollowUps} follow-up(s)` : 'No follow-ups',
                    `Phone camera: ${humanize(config.secondaryCamera)}`,
                    config.recordingEnabled ? 'Recording requested' : 'No recording',
                  ].join(' · ')}
                </Detail>
              </dl>
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer font-medium text-brand">Job description</summary>
                <p className="mt-2 whitespace-pre-line text-ink-muted">{interview.jobDescription}</p>
              </details>
            </>
          )}
        </Step>

        <Step
          number={2}
          title="Resume"
          description="Optional, but questions are more relevant with the candidate’s resume."
          done={interview.resume?.extractionStatus === 'COMPLETED'}
        >
          <ResumeUpload interviewId={interview.id} resume={interview.resume} disabled={!isDraft} onUploaded={(resume) => patch({ resume })} />
        </Step>

        <Step
          number={3}
          title="Questions"
          description="Generate, edit and reorder. Candidates hear them in this order."
          done={hasQuestions && !questionsDirty}
        >
          {extracting && (
            <Alert tone="info" className="mb-4">
              The resume is still being processed. You can generate questions now, but they will not use the resume yet.
            </Alert>
          )}
          <QuestionEditor
            interviewId={interview.id}
            questions={interview.questions}
            defaultCount={config.questionCount}
            locked={!isDraft}
            onSaved={(questions) => patch({ questions, questionCount: questions.length })}
            onDirtyChange={setQuestionsDirty}
          />
        </Step>

        <Step number={4} title="Invite the candidate" done={!isDraft}>
          {isDraft ? (
            <div className="space-y-3">
              {readyError && <Alert tone="danger">{readyError}</Alert>}
              <p className="text-sm text-ink-muted">
                Marking the interview ready locks the questions and creates a one-time invitation code and access code for{' '}
                {interview.candidateName}.
              </p>
              <Button onClick={markReady} loading={readying} disabled={!hasQuestions || questionsDirty} icon={<Send className="h-4 w-4" aria-hidden />}>
                Mark ready and create invitation
              </Button>
              {(!hasQuestions || questionsDirty) && (
                <p className="text-xs text-ink-muted">{questionsDirty ? 'Save your question changes first.' : 'Save at least one question first.'}</p>
              )}
            </div>
          ) : isCancelled ? (
            <p className="text-sm text-ink-muted">The invitation was withdrawn when this interview was cancelled.</p>
          ) : interview.invitation ? (
            <InvitationCard invitation={interview.invitation} candidateEmail={interview.candidateEmail} />
          ) : (
            <p className="text-sm text-ink-muted">The invitation has been issued for this interview.</p>
          )}
          {!isDraft && interview.status !== 'READY' && (!isCancelled || interview.startedAt) && (
            <div className="mt-4 flex gap-2">
              {!isCancelled && (
                <Link to={`/recruiter/interviews/${interview.id}/monitor`} className={buttonClasses('secondary', 'sm')}>
                  <Radio className="h-3.5 w-3.5" aria-hidden />
                  Monitor
                </Link>
              )}
              <Link to={`/recruiter/interviews/${interview.id}/report`} className={buttonClasses('secondary', 'sm')}>
                <FileText className="h-3.5 w-3.5" aria-hidden />
                Report
              </Link>
            </div>
          )}
        </Step>
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}
