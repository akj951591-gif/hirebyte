import type { ReactNode } from 'react';
import { Inbox, Loader2, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';
import { Button } from './Button';
import { cn } from './cn';

export function Spinner({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 text-sm text-ink-muted', className)}>
      <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function LoadingState({ label }: { label?: string }) {
  return <Spinner label={label} className="py-16" />;
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  code?: string;
  requestId?: string;
  onRetry?: () => void;
  action?: ReactNode;
}

/** Actionable error panel. Shows permission/network variants based on the error code. */
export function ErrorState({ title, message, code, requestId, onRetry, action }: ErrorStateProps) {
  const isPermission = code === 'FORBIDDEN' || code === 'UNAUTHENTICATED';
  const isNetwork = code === 'NETWORK_ERROR' || code === 'SERVICE_UNAVAILABLE';
  const Icon = isPermission ? ShieldAlert : isNetwork ? WifiOff : ShieldAlert;
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-14 text-center" role="alert">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <div>
        <p className="font-semibold text-ink">
          {title ?? (isPermission ? 'You do not have access to this' : isNetwork ? 'Service unavailable' : 'Something went wrong')}
        </p>
        <p className="mt-1 max-w-md text-sm text-ink-muted">{message}</p>
        {requestId && <p className="mt-1 font-mono text-xs text-ink-subtle">Reference: {requestId}</p>}
      </div>
      <div className="flex gap-2">
        {onRetry && (
          <Button variant="secondary" onClick={onRetry} icon={<RefreshCw className="h-4 w-4" aria-hidden />}>
            Try again
          </Button>
        )}
        {action}
      </div>
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-ink-subtle">
        <Inbox className="h-6 w-6" aria-hidden />
      </span>
      <div>
        <p className="font-semibold text-ink">{title}</p>
        {message && <p className="mt-1 max-w-md text-sm text-ink-muted">{message}</p>}
      </div>
      {action}
    </div>
  );
}
