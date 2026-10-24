import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, Trash2 } from 'lucide-react';
import { api, type InterviewDetail, type InterviewStatus } from '@/api/client';
import { toApiError } from '@/api/client/useAsync';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';

/** Issued but unfinished. Drafts are deleted instead; finished interviews keep their report. */
const CANCELLABLE: InterviewStatus[] = ['READY', 'ONBOARDING', 'IN_PROGRESS', 'PROCESSING_ANSWER'];

export const canCancelInterview = (status: InterviewStatus) => CANCELLABLE.includes(status);

type InterviewRef = Pick<InterviewDetail, 'id' | 'status' | 'candidateName' | 'jobTitle'>;

/** Cancels an issued interview after confirmation (PRD §8.1). The backend keeps saved answers. */
export function CancelInterviewButton({ interview, onCancelled }: { interview: InterviewRef; onCancelled: (updated: InterviewDetail) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canCancelInterview(interview.status)) return null;

  const started = interview.status !== 'READY';
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.interviews.cancel(interview.id);
      setOpen(false);
      onCancelled(updated);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={<Ban className="h-3.5 w-3.5" aria-hidden />}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Cancel interview
      </Button>
      <ConfirmDialog
        open={open}
        title="Cancel this interview?"
        confirmLabel="Cancel interview"
        cancelLabel="Keep interview"
        confirmVariant="danger"
        loading={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      >
        {error && (
          <Alert tone="danger" className="mb-3">
            {error}
          </Alert>
        )}
        <ul className="list-disc space-y-1 pl-5">
          <li>
            {started
              ? `${interview.candidateName} is signed out right away and cannot continue.`
              : `The invitation sent to ${interview.candidateName} stops working.`}
          </li>
          {started && <li>Answers already saved are kept and stay in the report. A recording in progress is stopped.</li>}
          <li>This cannot be undone. To interview them again, create a new interview.</li>
        </ul>
      </ConfirmDialog>
    </>
  );
}

/** Deletes a draft that was never sent to the candidate, then returns to the interview list. */
export function DeleteDraftButton({ interview }: { interview: InterviewRef }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (interview.status !== 'DRAFT') return null;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.interviews.remove(interview.id);
      navigate('/recruiter/interviews', { replace: true });
    } catch (err) {
      setError(toApiError(err).message);
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Delete draft
      </Button>
      <ConfirmDialog
        open={open}
        title="Delete this draft?"
        confirmLabel="Delete draft"
        cancelLabel="Keep draft"
        confirmVariant="danger"
        loading={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      >
        {error && (
          <Alert tone="danger" className="mb-3">
            {error}
          </Alert>
        )}
        The draft for {interview.jobTitle} — {interview.candidateName} and its questions are removed. Nothing has been sent to the candidate yet.
      </ConfirmDialog>
    </>
  );
}
