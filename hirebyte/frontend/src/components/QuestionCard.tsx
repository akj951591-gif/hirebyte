import type { ReactNode } from 'react';
import { cn } from './cn';

export interface QuestionCardProps {
  sequence: number;
  total?: number;
  text: ReactNode;
  /** Small labels such as category, difficulty, source. */
  tags?: string[];
  actions?: ReactNode;
  children?: ReactNode;
  size?: 'md' | 'lg';
  className?: string;
}

export function QuestionCard({ sequence, total, text, tags = [], actions, children, size = 'md', className }: QuestionCardProps) {
  return (
    <article className={cn('card p-5', className)} aria-label={`Question ${sequence}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-strong">
            Question {sequence}
            {total ? ` of ${total}` : ''}
          </span>
          {tags.map((tag) => (
            <span key={tag} className="rounded bg-surface-sunken px-2 py-0.5 text-xs text-ink-muted">
              {tag}
            </span>
          ))}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className={cn('mt-3 text-ink', size === 'lg' ? 'text-xl font-semibold leading-snug' : 'text-base font-medium')}>
        {text}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </article>
  );
}
