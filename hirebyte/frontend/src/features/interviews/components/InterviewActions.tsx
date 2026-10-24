import { Link } from 'react-router-dom';
import { FileText, PencilLine, Radio } from 'lucide-react';
import type { InterviewSummary } from '@/api/client';
import { buttonClasses } from '@/components/Button';

/** The one primary action that makes sense for an interview in its current state. */
export function InterviewActions({ interview }: { interview: InterviewSummary }) {
  const { id, status } = interview;
  if (status === 'DRAFT' || status === 'READY') {
    return (
      <Link to={`/recruiter/interviews/${id}/setup`} className={buttonClasses('secondary', 'sm', 'whitespace-nowrap')}>
        <PencilLine className="h-3.5 w-3.5" aria-hidden />
        {status === 'DRAFT' ? 'Continue setup' : 'View invite'}
      </Link>
    );
  }
  if (status === 'ONBOARDING' || status === 'IN_PROGRESS' || status === 'PROCESSING_ANSWER') {
    return (
      <Link to={`/recruiter/interviews/${id}/monitor`} className={buttonClasses('secondary', 'sm', 'whitespace-nowrap')}>
        <Radio className="h-3.5 w-3.5" aria-hidden />
        Monitor
      </Link>
    );
  }
  if (status === 'CANCELLED') {
    // Answers saved before cancelling are kept, so a started interview still has a report.
    return interview.startedAt ? (
      <Link to={`/recruiter/interviews/${id}/report`} className={buttonClasses('secondary', 'sm', 'whitespace-nowrap')}>
        <FileText className="h-3.5 w-3.5" aria-hidden />
        Report
      </Link>
    ) : (
      <Link to={`/recruiter/interviews/${id}/setup`} className={buttonClasses('ghost', 'sm', 'whitespace-nowrap')}>
        View
      </Link>
    );
  }
  return (
    <Link to={`/recruiter/interviews/${id}/report`} className={buttonClasses('secondary', 'sm', 'whitespace-nowrap')}>
      <FileText className="h-3.5 w-3.5" aria-hidden />
      Report
    </Link>
  );
}
