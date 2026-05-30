import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal, toast } from './ui';

// Per-user SMTP sender settings — invoice emails appear to come from this user.
export function UserEmailModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, refetch } = useQuery({ queryKey: ['my-smtp'], queryFn: () => api.get<any>('/auth/smtp'), enabled: open });
  const [f, setF] = useState({ smtp_host: '', smtp_port: '587', smtp_user: '', smtp_password: '', smtp_from_address: '', smtp_from_name: '', smtp_enabled: false });
  const [testTo, setTestTo] = useState('');
  useEffect(() => {
    if (data) setF((p) => ({ ...p, smtp_host: data.smtp_host ?? '', smtp_port: String(data.smtp_port ?? 587), smtp_user: data.smtp_user ?? '', smtp_from_address: data.smtp_from_address ?? '', smtp_from_name: data.smtp_from_name ?? '', smtp_enabled: !!data.smtp_enabled }));
  }, [data]);
  const save = useMutation({
    mutationFn: () => api.put('/auth/smtp', { ...f, smtp_port: Number(f.smtp_port), smtp_password: f.smtp_password || undefined }),
    onSuccess: () => { toast('Email settings saved'); setF((p) => ({ ...p, smtp_password: '' })); refetch(); },
    onError: (e: any) => toast(e.message, 'err'),
  });
  const test = useMutation({ mutationFn: () => api.post('/auth/smtp/test', { to: testTo || undefined }), onSuccess: () => toast('SMTP verified'), onError: (e: any) => toast(e.message, 'err') });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal open={open} onClose={onClose} title="My Email (sender) settings" wide>
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Invoice emails you send appear to come from you. Enter your own mail server for full
          authentication, or just a From address to ride the company relay. Leave the server
          blank to use the company default. Passwords are encrypted at rest.
          {data?.smtp_password_set ? ' A password is currently stored.' : ''}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">From address</label><input className="input" placeholder="you@firm.com" value={f.smtp_from_address} onChange={set('smtp_from_address')} /></div>
          <div><label className="label">From name</label><input className="input" placeholder="Your Name" value={f.smtp_from_name} onChange={set('smtp_from_name')} /></div>
        </div>
        <div className="rounded-lg border border-line p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Personal mail server (optional)</div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Host</label><input className="input" placeholder="(blank = company relay)" value={f.smtp_host} onChange={set('smtp_host')} /></div>
            <div><label className="label">Port</label><input className="input" value={f.smtp_port} onChange={set('smtp_port')} /></div>
            <div><label className="label">Username</label><input className="input" value={f.smtp_user} onChange={set('smtp_user')} /></div>
            <div><label className="label">Password</label><input className="input" type="password" placeholder={data?.smtp_password_set ? '••••••• (unchanged)' : ''} value={f.smtp_password} onChange={set('smtp_password')} /></div>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.smtp_enabled} onChange={(e) => setF({ ...f, smtp_enabled: e.target.checked })} /> Send through my personal mail server (requires host above)</label>
        <div className="flex items-center gap-2 pt-1">
          <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>Save</button>
          <input className="input w-48" placeholder="test recipient" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button className="btn-ghost" onClick={() => test.mutate()} disabled={test.isPending || !f.smtp_host}>Test my server</button>
          <button className="btn-ghost ml-auto" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
