import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Briefcase, CheckCircle2, UserRound } from 'lucide-react';
import { appConfig } from '@/config/app.config';
import { Logo } from '@/components/Logo';
import { cn } from '@/components/cn';

const highlights = [
  'Job-relevant questions generated from the role and resume',
  'Voice-led interview with saved progress',
  'Evidence-based reports for human review',
];

/**
 * Shared frame for the two login pages. Candidate and recruiter logins stay separate routes
 * (PRD §2) — the tabs simply link between them.
 */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  // The Recruiter tab also stays selected on the sign-up page (/recruiter/register).
  const onRecruiterPages = useLocation().pathname.startsWith('/recruiter');
  return (
    <div className="flex min-h-full flex-1">
      <aside className="relative hidden w-[42%] flex-col justify-between overflow-hidden bg-brand-strong p-10 text-ink-inverse lg:flex">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-accent/20 blur-3xl"
          aria-hidden
        />
        <Logo inverse />
        <div className="relative">
          <h2 className="text-3xl font-semibold leading-tight">
            Fair, structured first-round interviews.
          </h2>
          <p className="mt-3 max-w-sm text-ink-inverse/75">{appConfig.tagline}. Recruiters stay in control of every decision.</p>
          <ul className="mt-8 space-y-3">
            {highlights.map((h) => (
              <li key={h} className="flex items-start gap-2.5 text-sm text-ink-inverse/90">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                {h}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-ink-inverse/60">
          © {new Date().getFullYear()} {appConfig.companyName}
        </p>
      </aside>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <nav aria-label="Choose how to sign in" className="mb-8 grid grid-cols-2 gap-1 rounded-lg bg-surface-sunken p-1">
            <AuthTab to="/candidate/login" icon={<UserRound className="h-4 w-4" aria-hidden />}>
              Candidate
            </AuthTab>
            <AuthTab to="/recruiter/login" active={onRecruiterPages} icon={<Briefcase className="h-4 w-4" aria-hidden />}>
              Recruiter
            </AuthTab>
          </nav>
          <h1 className="text-2xl font-semibold text-ink">{title}</h1>
          <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

function AuthTab({ to, icon, children, active }: { to: string; icon: ReactNode; children: ReactNode; active?: boolean }) {
  return (
    <NavLink
      to={to}
      replace
      className={({ isActive }) =>
        cn(
          'flex items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors',
          (active ?? isActive) ? 'bg-surface text-brand-strong shadow-card' : 'text-ink-muted hover:text-ink',
        )
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}
