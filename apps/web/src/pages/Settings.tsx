import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '@darrow/shared';
import { PageHeader } from '@/components/Layout';
import { Skeleton, toast } from '@/components/ui';

export function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<any>('/settings') });
  const [tab, setTab] = useState<'company' | 'branding' | 'markups'>('company');
  if (isLoading) return <div><PageHeader title="Settings" /><Skeleton /></div>;
  return (
    <div>
      <PageHeader title="Settings" subtitle="Company, branding & markup defaults" />
      <div className="mb-5 flex gap-2 border-b border-line">
        {(['company', 'branding', 'markups'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm font-medium capitalize ${tab === t ? 'border-b-2 border-copper text-copper' : 'text-muted'}`}>{t}</button>
        ))}
      </div>
      {tab === 'company' && <Company data={data} onSaved={() => qc.invalidateQueries({ queryKey: ['settings'] })} />}
      {tab === 'branding' && <Branding data={data} onSaved={() => qc.invalidateQueries({ queryKey: ['settings'] })} />}
      {tab === 'markups' && <Markups data={data} onSaved={() => qc.invalidateQueries({ queryKey: ['settings'] })} />}
    </div>
  );
}

function Company({ data, onSaved }: { data: any; onSaved: () => void }) {
  const [f, setF] = useState<any>({});
  useEffect(() => setF({ company_name: data.companyName, address_line1: data.addressLine1, address_line2: data.addressLine2, city: data.city, state: data.state, zip: data.zip, phone: data.phone, email: data.email }), [data]);
  const m = useMutation({ mutationFn: () => api.put('/settings', f), onSuccess: () => { toast('Saved'); onSaved(); }, onError: (e: any) => toast(e.message, 'err') });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="card max-w-xl space-y-3 p-5">
      <div><label className="label">Company name</label><input className="input" value={f.company_name ?? ''} onChange={set('company_name')} /></div>
      <div><label className="label">Address line 1</label><input className="input" value={f.address_line1 ?? ''} onChange={set('address_line1')} /></div>
      <div><label className="label">Address line 2</label><input className="input" value={f.address_line2 ?? ''} onChange={set('address_line2')} /></div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="label">City</label><input className="input" value={f.city ?? ''} onChange={set('city')} /></div>
        <div><label className="label">State</label><input className="input" value={f.state ?? ''} onChange={set('state')} /></div>
        <div><label className="label">Zip</label><input className="input" value={f.zip ?? ''} onChange={set('zip')} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Phone</label><input className="input" value={f.phone ?? ''} onChange={set('phone')} /></div>
        <div><label className="label">Email</label><input className="input" value={f.email ?? ''} onChange={set('email')} /></div>
      </div>
      <button className="btn-primary" onClick={() => m.mutate()} disabled={m.isPending}>Save</button>
    </div>
  );
}

function Branding({ data, onSaved }: { data: any; onSaved: () => void }) {
  async function up(kind: 'logo' | 'template', file: File) {
    try { await api.upload(`/settings/${kind}`, file); toast(`${kind} uploaded`); onSaved(); } catch (e: any) { toast(e.message, 'err'); }
  }
  return (
    <div className="card max-w-xl space-y-4 p-5">
      <div>
        <label className="label">Logo (PNG/JPG, max 2MB)</label>
        {data.logoPath && <img src={`/api/settings/logo?t=${Date.now()}`} alt="logo" className="mb-2 h-16" />}
        <input type="file" accept="image/png,image/jpeg" onChange={(e) => e.target.files?.[0] && up('logo', e.target.files[0])} />
      </div>
      <div>
        <label className="label">Invoice template (.docx, max 5MB)</label>
        <div className="mb-2 text-sm text-muted">{data.templateDocxPath ? 'Template uploaded' : 'No template'} · <a className="text-copper" href="/api/settings/template/download">download current</a></div>
        <input type="file" accept=".docx" onChange={(e) => e.target.files?.[0] && up('template', e.target.files[0])} />
      </div>
    </div>
  );
}

function Markups({ data, onSaved }: { data: any; onSaved: () => void }) {
  const init = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, String((data.markups.find((m: any) => m.category === c)?.percent ?? 0) * 100)]));
  const [map, setMap] = useState<Record<string, string>>(init);
  const m = useMutation({ mutationFn: () => api.put('/settings/markups', EXPENSE_CATEGORIES.map((c) => ({ category: c, percent: Number(map[c]) / 100 }))), onSuccess: () => { toast('Saved'); onSaved(); } });
  return (
    <div className="card max-w-md space-y-2 p-5">
      {EXPENSE_CATEGORIES.map((c) => (
        <div key={c} className="flex items-center gap-3">
          <div className="w-40 text-sm">{EXPENSE_CATEGORY_LABELS[c]}</div>
          <input className="input w-28" value={map[c]} onChange={(e) => setMap({ ...map, [c]: e.target.value })} />
          <span className="text-sm text-muted">%</span>
        </div>
      ))}
      <button className="btn-primary mt-3" onClick={() => m.mutate()} disabled={m.isPending}>Save defaults</button>
    </div>
  );
}
