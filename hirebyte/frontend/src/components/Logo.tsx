import { appConfig } from '@/config/app.config';
import { cn } from './cn';

export function Logo({ className, inverse = false }: { className?: string; inverse?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" className={inverse ? 'fill-ink-inverse' : 'fill-brand'} />
        <path
          d="M9 8v16M9 16h8M17 8v16"
          strokeWidth="3"
          strokeLinecap="round"
          className={inverse ? 'stroke-brand' : 'stroke-ink-inverse'}
        />
        <circle cx="23.5" cy="20.5" r="3" className="fill-accent" />
      </svg>
      <span className={cn('text-lg', inverse ? 'text-ink-inverse' : 'text-ink')}>{appConfig.productName}</span>
    </span>
  );
}
