import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, ListChecks, LogOut, Menu, PlusCircle, X } from 'lucide-react';
import type { SafeUser } from '@/api/client';
import { useRecruiterAuth } from '@/features/auth';
import { Logo } from '@/components/Logo';
import { cn } from '@/components/cn';

const nav = [
  { to: '/recruiter', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/recruiter/interviews', label: 'Interviews', icon: ListChecks, end: true },
  { to: '/recruiter/interviews/new', label: 'New interview', icon: PlusCircle, end: true },
];

export function RecruiterLayout({ user }: { user: SafeUser }) {
  const { logout } = useRecruiterAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const onLogout = async () => {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      navigate('/recruiter/login', { replace: true });
    }
  };

  const links = (
    <ul className="space-y-1">
      {nav.map(({ to, label, icon: Icon, end }) => (
        <li key={to}>
          <NavLink
            to={to}
            end={end}
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-brand-soft text-brand-strong' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
              )
            }
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  );

  const account = (
    <div className="border-t border-line pt-4">
      <p className="truncate text-sm font-medium text-ink">{user.name}</p>
      <p className="truncate text-xs text-ink-muted">{user.email}</p>
      <button
        type="button"
        onClick={onLogout}
        disabled={signingOut}
        className="mt-3 flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-60"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );

  return (
    <div className="flex flex-1">
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between border-r border-line bg-surface p-4 lg:flex">
        <div>
          <div className="mb-6 px-2">
            <Logo />
            <p className="mt-1 text-xs text-ink-subtle">Recruiter workspace</p>
          </div>
          <nav aria-label="Recruiter">{links}</nav>
        </div>
        {account}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
          <Logo />
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls="recruiter-mobile-nav"
            className="rounded p-2 text-ink-muted hover:bg-surface-sunken"
          >
            {menuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          </button>
        </header>
        {menuOpen && (
          <div id="recruiter-mobile-nav" className="no-print space-y-4 border-b border-line bg-surface p-4 lg:hidden">
            <nav aria-label="Recruiter">{links}</nav>
            {account}
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Consistent page heading for recruiter pages. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
