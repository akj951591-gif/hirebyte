import { useRef, useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { api, type ResumeInfo } from '@/api/client';
import { toApiError } from '@/api/client/useAsync';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { StatusBadge, type Tone } from '@/components/StatusBadge';
import { formatBytes } from '@/utils/format';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const extractionMeta: Record<ResumeInfo['extractionStatus'], { label: string; tone: Tone; live?: boolean }> = {
  PENDING: { label: 'Queued', tone: 'info', live: true },
  PROCESSING: { label: 'Extracting text', tone: 'info', live: true },
  COMPLETED: { label: 'Text extracted', tone: 'success' },
  FAILED: { label: 'Extraction failed', tone: 'danger' },
};

const failureText: Record<string, string> = {
  RESUME_UNREADABLE: 'The file has no readable text (for example a scanned image or password-protected PDF). Upload a text-based PDF or DOCX.',
  RESUME_UNSUPPORTED: 'This file type is not supported. Upload a PDF or DOCX.',
};

export function ResumeUpload({
  interviewId,
  resume,
  disabled,
  onUploaded,
}: {
  interviewId: string;
  resume: ResumeInfo | null;
  disabled?: boolean;
  onUploaded: (resume: ResumeInfo) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      setError('Upload a PDF or DOCX file.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That file is ${formatBytes(file.size)}. The limit is 5 MB.`);
      return;
    }
    setUploading(true);
    try {
      const { resume: uploaded } = await api.interviews.uploadResume(interviewId, file);
      onUploaded(uploaded);
    } catch (err) {
      const apiError = toApiError(err);
      setError(failureText[apiError.code] ?? apiError.message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const meta = resume ? extractionMeta[resume.extractionStatus] : null;

  return (
    <div className="space-y-3">
      {resume && meta && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-line p-3">
          <FileText className="h-5 w-5 text-brand" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{resume.filename}</p>
            <p className="text-xs text-ink-muted">{formatBytes(resume.sizeBytes)}</p>
          </div>
          <StatusBadge tone={meta.tone} live={meta.live}>
            {meta.label}
          </StatusBadge>
        </div>
      )}
      {resume?.extractionStatus === 'FAILED' && (
        <Alert tone="danger">{failureText[resume.failureCode ?? ''] ?? 'We could not read this resume. Try a different file.'}</Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        id={`resume-${interviewId}`}
        onChange={(e) => void onFile(e.target.files?.[0])}
        disabled={disabled || uploading}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={resume ? 'secondary' : 'primary'}
          onClick={() => inputRef.current?.click()}
          loading={uploading}
          disabled={disabled}
          icon={<Upload className="h-4 w-4" aria-hidden />}
        >
          {uploading ? 'Uploading…' : resume ? 'Replace resume' : 'Upload resume'}
        </Button>
        <span className="text-xs text-ink-muted">PDF or DOCX, up to 5 MB. Used only to tailor questions for this interview.</span>
      </div>
    </div>
  );
}
