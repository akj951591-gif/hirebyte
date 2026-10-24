import type { ReactNode } from 'react';
import { cn } from './cn';

export type Tone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted',
  brand: 'bg-brand-soft text-brand-strong',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

const dotClasses: Record<Tone, string> = {
  neutral: 'bg-ink-subtle',
  brand: 'bg-brand',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export interface StatusBadgeProps {
  tone?: Tone;
  children: ReactNode;
  /** Pulsing dot for live states such as "In progress" or "Recording". */
  live?: boolean;
  className?: string;
}

export function StatusBadge({ tone = 'neutral', children, live, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
        toneClasses[tone],
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        {live && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', dotClasses[tone])} />}
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', dotClasses[tone])} />
      </span>
      {children}
    </span>
  );
}
