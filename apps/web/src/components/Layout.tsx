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
  Zap,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { UserEmailModal } from './UserEmailModal';

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
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-copper-deep text-xs font-bold text-white">
              {(user?.username ?? '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">{user?.username}</div>
              <div className="text-xs capitalize text-paper/50">{user?.role}</div>
            </div>
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
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-8 py-8">{children}</div>
      </main>
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
