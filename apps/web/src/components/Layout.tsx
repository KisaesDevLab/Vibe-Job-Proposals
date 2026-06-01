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
  Settings as SettingsIcon,
  LogOut,
  Mail,
  KeyRound,
  Zap,
  Maximize2,
  Minimize2,
  Type,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
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
    { to: '/settings', label: 'Settings', icon: SettingsIcon },
  ] },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [emailOpen, setEmailOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const { fontScale, wideMode } = usePrefs();

  async function logout() {
    await api.post('/auth/logout');
    refresh();
    window.location.href = '/login';
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-60 flex-col bg-ink text-paper">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-copper text-white"><Zap size={20} /></div>
          <div>
            <div className="font-bold leading-tight">Darrow</div>
            <div className="text-xs text-paper/60">Time &amp; Invoicing</div>
          </div>
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
                    <Link key={it.to} to={it.to} className={`navlink ${active ? 'navlink-active' : ''}`}>
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
              className="rounded p-1.5 text-paper/60 hover:bg-white/10 hover:text-white"
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
      <main className="flex-1 overflow-y-auto">
        <div className={`${wideMode ? 'w-full' : 'mx-auto max-w-7xl'} px-8 py-8`}>{children}</div>
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
    <div className="mb-6 flex items-end justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
