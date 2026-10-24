import { QRCodeSVG } from 'qrcode.react';
import { Smartphone } from 'lucide-react';
import type { PhonePairing, SecondaryCameraPolicy } from '@/api/client';
import { StatusBadge, type Tone } from '@/components/StatusBadge';
import { formatTime } from '@/utils/format';

const statusMeta: Record<PhonePairing['status'], { label: string; tone: Tone }> = {
  NOT_PAIRED: { label: 'Waiting for phone', tone: 'neutral' },
  PAIRED: { label: 'Phone connected', tone: 'success' },
  DISCONNECTED: { label: 'Phone disconnected', tone: 'warning' },
  EXPIRED: { label: 'Code expired', tone: 'danger' },
};

/**
 * Shows the short-lived pairing link as a QR code. The link itself carries a one-time pairing token
 * issued by the backend; the QR code is only a convenient way to open it (PRD §9.1).
 */
export function PhonePairingQR({ pairing, policy }: { pairing: PhonePairing | null; policy: SecondaryCameraPolicy }) {
  if (policy === 'OFF') return null;
  const meta = pairing ? statusMeta[pairing.status] : null;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-lg border border-line bg-surface p-2">
        {pairing && pairing.status !== 'EXPIRED' && pairing.status !== 'PAIRED' ? (
          <QRCodeSVG value={pairing.url} size={140} level="M" aria-label="QR code to connect your phone camera" />
        ) : (
          <Smartphone className="h-10 w-10 text-ink-subtle" aria-hidden />
        )}
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-ink">Phone camera {policy === 'REQUIRED' ? '(required)' : '(optional)'}</p>
          {meta && (
            <StatusBadge tone={meta.tone} live={pairing?.status === 'PAIRED'}>
              {meta.label}
            </StatusBadge>
          )}
        </div>
        {!pairing ? (
          <p className="text-ink-muted">Phone pairing is not available for this session yet. Please contact the recruiter.</p>
        ) : pairing.status === 'PAIRED' ? (
          <p className="text-ink-muted">Your phone camera is connected. Keep the phone propped up so it shows you and your desk.</p>
        ) : pairing.status === 'EXPIRED' ? (
          <p className="text-ink-muted">This pairing code expired. Refresh the page to get a new one.</p>
        ) : (
          <ol className="list-decimal space-y-1 pl-4 text-ink-muted">
            <li>Open your phone camera and scan this code.</li>
            <li>Allow camera access in the page that opens.</li>
            <li>Place the phone to your side so it shows you and your desk.</li>
          </ol>
        )}
        {pairing && pairing.status !== 'PAIRED' && (
          <p className="text-xs text-ink-subtle">Code valid until {formatTime(pairing.expiresAt)}. It works once, for this interview only.</p>
        )}
      </div>
    </div>
  );
}
