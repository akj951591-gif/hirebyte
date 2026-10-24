import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from './cn';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const styles: Record<AlertTone, { box: string; icon: ReactNode }> = {
  info: { box: 'border-info/30 bg-info-soft text-info', icon: <Info className="h-5 w-5" aria-hidden /> },
  success: { box: 'border-success/30 bg-success-soft text-success', icon: <CheckCircle2 className="h-5 w-5" aria-hidden /> },
  warning: { box: 'border-warning/30 bg-warning-soft text-warning', icon: <AlertTriangle className="h-5 w-5" aria-hidden /> },
  danger: { box: 'border-danger/30 bg-danger-soft text-danger', icon: <XCircle className="h-5 w-5" aria-hidden /> },
};

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function Alert({ tone = 'info', title, children, action, className }: AlertProps) {
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded border px-4 py-3 text-sm', styles[tone].box, className)}
    >
      <span className="mt-0.5 shrink-0">{styles[tone].icon}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn('text-ink', title ? 'mt-0.5' : undefined)}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
