import { Link, useRouterState } from '@tanstack/react-router';
import {
  Clock,
  Receipt,
  FileText,
  Briefcase,
  Building2,
  Users,
  BarChart3,
  ShieldCheck,
  UserCog,
  Settings as SettingsIcon,
  LogOut,
  Mail,
  KeyRound,
  Zap,
  Maximize2,
  Minimize2,
  Type,
  Upload,
  Menu,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePrefs, setFontScale, setWideMode, type FontScale } from '@/lib/prefs';
import { UserEmailModal } from './UserEmailModal';
import { ChangePasswordModal } from './ChangePasswordModal';

const NAV = [
  { group: 'Operations', items: [
    { to: '/time', label: 'Time Grid', icon: Clock },
    { to: '/expenses', label: 'Expenses', icon: Receipt },
    { to: '/invoices', label: 'Invoices', icon: FileText },
  ] },
  { group: 'Records', items: [
    { to: '/jobs', label: 'Jobs', icon: Briefcase },
    { to: '/customers', label: 'Customers', icon: Building2 },
    { to: '/employees', label: 'Employees', icon: Users },
  ] },
  { group: 'Insight', items: [
    { to: '/reports', label: 'Reports', icon: BarChart3 },
    { to: '/readiness', label: 'Readiness', icon: ShieldCheck },
    { to: '/import', label: 'Import', icon: Upload },
    { to: '/users', label: 'Users', icon: UserCog },
    { to: '/settings', label: 'Settings', icon: SettingsIcon },
  ] },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [emailOpen, setEmailOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false); // mobile drawer
  const { fontScale, wideMode } = usePrefs();

  // Close the mobile drawer whenever the route changes (e.g. after tapping a
  // nav link) so it doesn't stay open over the new page.
  useEffect(() => { setNavOpen(false); }, [path]);

  async function logout() {
    // Fail-safe: attempt the server-side logout, but even if it rejects
    // (network/5xx) still clear client state and redirect, rather than leaving
    // an unhandled rejection and the user stuck on a half-logged-out screen.
    try {
      await api.post('/auth/logout');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('logout request failed; clearing session client-side', err);
    } finally {
      refresh();
      window.location.href = '/login';
    }
  }

  return (
    <div className="flex h-full">
      {/* Backdrop behind the drawer on mobile */}
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-ink/50 lg:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 max-w-[80%] transform flex-col bg-ink text-paper transition-transform duration-200 lg:static lg:z-auto lg:max-w-none lg:translate-x-0 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-copper text-white"><Zap size={20} /></div>
          <div className="flex-1">
            <div className="font-bold leading-tight">Darrow</div>
            <div className="text-xs text-paper/60">Time &amp; Invoicing</div>
          </div>
          {/* Close button — drawer only */}
          <button onClick={() => setNavOpen(false)} className="rounded p-1.5 text-paper/60 hover:bg-white/10 hover:text-white lg:hidden" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-paper/40">{g.group}</div>
              <div className="space-y-0.5">
                {g.items.map((it) => {
                  const Icon = it.icon;
                  const active = path.startsWith(it.to);
                  return (
                    <Link key={it.to} to={it.to} onClick={() => setNavOpen(false)} className={`navlink ${active ? 'navlink-active' : ''}`}>
                      <Icon size={16} /> {it.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="mb-2 flex items-center justify-between gap-2 px-2">
            <FontScalePicker value={fontScale} onChange={setFontScale} />
            <button
              onClick={() => setWideMode(!wideMode)}
              title={wideMode ? 'Switch to comfortable width' : 'Switch to full width'}
              className="hidden rounded p-1.5 text-paper/60 hover:bg-white/10 hover:text-white lg:block"
            >
              {wideMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-copper-deep text-xs font-bold text-white">
              {(user?.username ?? '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">{user?.username}</div>
              <div className="text-xs capitalize text-paper/50">{user?.role}</div>
            </div>
            <button onClick={() => setPwOpen(true)} title="Change password" className="rounded p-1.5 text-paper/60 hover:bg-white/10 hover:text-white">
              <KeyRound size={16} />
            </button>
            <button onClick={() => setEmailOpen(true)} title="My email settings" className="rounded p-1.5 text-paper/60 hover:bg-white/10 hover:text-white">
              <Mail size={16} />
            </button>
            <button onClick={logout} title="Log out" className="rounded p-1.5 text-paper/60 hover:bg-white/10 hover:text-white">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <UserEmailModal open={emailOpen} onClose={() => setEmailOpen(false)} />
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar with hamburger — hidden on lg where the sidebar is always visible */}
        <header className="flex items-center gap-3 border-b border-line bg-card px-4 py-3 lg:hidden">
          <button onClick={() => setNavOpen(true)} className="rounded-lg p-1.5 text-ink hover:bg-paper" aria-label="Open menu">
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-copper text-white"><Zap size={16} /></div>
            <span className="font-bold">Darrow</span>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          <div className={`${wideMode ? 'w-full' : 'mx-auto max-w-7xl'} px-4 py-6 sm:px-6 lg:px-8 lg:py-8`}>{children}</div>
        </div>
      </main>
    </div>
  );
}

function FontScalePicker({ value, onChange }: { value: FontScale; onChange: (s: FontScale) => void }) {
  const opts: { v: FontScale; label: string; size: number }[] = [
    { v: 'sm', label: 'A', size: 10 },
    { v: 'md', label: 'A', size: 13 },
    { v: 'lg', label: 'A', size: 16 },
    { v: 'xl', label: 'A', size: 19 },
  ];
  return (
    <div className="flex items-center gap-1 rounded-md bg-white/5 p-0.5" title="Text size">
      <Type size={12} className="ml-1 text-paper/40" />
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`grid h-6 w-6 place-items-center rounded font-bold leading-none ${
            value === o.v ? 'bg-copper text-white' : 'text-paper/60 hover:bg-white/10 hover:text-white'
          }`}
          style={{ fontSize: o.size }}
          title={`Text size: ${o.v.toUpperCase()}`}
          aria-pressed={value === o.v}
          aria-label={`Text size ${o.v}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
