import { type ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-paper"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-copper" />;
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-line/40" />
      ))}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card grid place-items-center py-16 text-center">
      <div className="text-muted">{title}</div>
      {hint && <div className="mt-1 text-sm text-muted/70">{hint}</div>}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-blue-soft text-blue',
  finalized: 'bg-green-soft text-green',
  void: 'bg-red-soft text-red',
  ready: 'bg-green-soft text-green',
  pending: 'bg-amber/20 text-amber',
  failed: 'bg-red-soft text-red',
  tm: 'bg-blue-soft text-blue',
  quote: 'bg-copper-soft text-copper-deep',
};
export function Badge({ status, children }: { status?: string; children?: ReactNode }) {
  const cls = (status && STATUS_COLORS[status]) || 'bg-paper text-muted';
  return <span className={`badge ${cls}`}>{children ?? status}</span>;
}

export function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
  // Errors stay long enough to read AND can be dismissed or copied. Success
  // toasts keep the snappy 3.2s. Hover pauses the auto-dismiss timer.
  const el = document.createElement('div');
  el.className = `fixed bottom-5 right-5 z-[100] flex max-w-md items-start gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg ${kind === 'ok' ? 'bg-green' : 'bg-red'}`;

  const text = document.createElement('span');
  text.textContent = msg;
  text.className = 'flex-1 whitespace-pre-wrap break-words';
  el.appendChild(text);

  if (kind === 'err') {
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.className = 'rounded border border-white/40 px-1.5 py-0.5 text-xs hover:bg-white/10';
    copy.title = 'Copy message';
    copy.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(msg).then(() => { copy.textContent = 'Copied'; }).catch(() => { copy.textContent = 'Failed'; });
    };
    el.appendChild(copy);
  }

  const close = document.createElement('button');
  close.textContent = '×';
  close.className = 'text-lg leading-none opacity-80 hover:opacity-100';
  close.title = 'Dismiss';
  close.onclick = () => el.remove();
  el.appendChild(close);

  document.body.appendChild(el);
  const ttl = kind === 'err' ? 20000 : 3200;
  let timer = window.setTimeout(() => el.remove(), ttl);
  el.addEventListener('mouseenter', () => window.clearTimeout(timer));
  el.addEventListener('mouseleave', () => { timer = window.setTimeout(() => el.remove(), 4000); });
}
