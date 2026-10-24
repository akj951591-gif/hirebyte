import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Invitation } from '@/api/client';
import { formatDateTime } from '@/utils/format';

function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div>
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded border border-line bg-surface px-3 py-2">
        <span className={`min-w-0 flex-1 truncate text-sm text-ink ${mono ? 'font-mono' : ''}`}>{value}</span>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

/** What the recruiter sends to the candidate. The access code is a second factor alongside the link. */
export function InvitationCard({ invitation, candidateEmail }: { invitation: Invitation; candidateEmail: string }) {
  const link = new URL(invitation.url, window.location.origin).toString();
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <CopyField label="Invitation code" value={invitation.code} />
        <CopyField label="Access code" value={invitation.accessCode} />
      </div>
      <CopyField label="Candidate link" value={link} mono={false} />
      <p className="text-xs text-ink-muted">
        Send the link and access code to {candidateEmail}. They expire {formatDateTime(invitation.expiresAt)} and work only for this
        interview. Send the access code separately from the link if you can.
      </p>
    </div>
  );
}
