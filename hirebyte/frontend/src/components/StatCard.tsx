import type { ReactNode } from 'react';
import { cn } from './cn';

export function StatCard({ label, value, icon, hint, className }: { label: string; value: ReactNode; icon?: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn('card flex items-start justify-between gap-3 p-5', className)}>
      <div>
        <p className="text-sm text-ink-muted">{label}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">{value}</p>
        {hint && <p className="mt-1 text-xs text-ink-subtle">{hint}</p>}
      </div>
      {icon && <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft text-brand">{icon}</span>}
    </div>
  );
}
