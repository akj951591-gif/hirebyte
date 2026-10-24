import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Check } from 'lucide-react';
import type { CandidateSessionView } from '@/api/client';
import { Logo } from '@/components/Logo';
import { cn } from '@/components/cn';

const steps = [
  { path: '/candidate/lobby', label: 'Welcome & consent' },
  { path: '/candidate/device-check', label: 'Device check' },
  { path: '/candidate/interview', label: 'Interview' },
  { path: '/candidate/complete', label: 'Done' },
];

/** Candidate chrome: branding, interview title and a step indicator. No recruiter navigation. */
export function CandidateLayout({ session, children }: { session?: CandidateSessionView; children: ReactNode }) {
  const { pathname } = useLocation();
  const current = steps.findIndex((s) => s.path === pathname);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Logo />
          {session && (
            <div className="text-right">
              <p className="text-sm font-medium text-ink">{session.jobTitle}</p>
              <p className="text-xs text-ink-muted">{session.companyName}</p>
            </div>
          )}
        </div>
        {current >= 0 && (
          <nav aria-label="Interview steps" className="mx-auto max-w-6xl px-4 pb-3 sm:px-6">
            <ol className="flex items-center gap-2 overflow-x-auto text-xs">
              {steps.map((step, i) => {
                const done = i < current;
                const active = i === current;
                return (
                  <li key={step.path} className="flex shrink-0 items-center gap-2">
                    <span
                      aria-current={active ? 'step' : undefined}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium',
                        active && 'bg-brand text-ink-inverse',
                        done && 'bg-success-soft text-success',
                        !active && !done && 'bg-surface-sunken text-ink-subtle',
                      )}
                    >
                      {done ? <Check className="h-3 w-3" aria-hidden /> : <span aria-hidden>{i + 1}</span>}
                      {step.label}
                    </span>
                    {i < steps.length - 1 && <span className="h-px w-4 bg-line" aria-hidden />}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
