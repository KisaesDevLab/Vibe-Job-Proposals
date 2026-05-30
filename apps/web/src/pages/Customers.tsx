import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatPercent, formatMoney, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '@darrow/shared';
import { PageHeader } from '@/components/Layout';
import { Modal, Skeleton, Empty, Badge, toast } from '@/components/ui';

interface Customer { id: string; name: string; billToCity: string; active: boolean; job_count: number; markups: Record<string, number>; }

export function CustomersPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['customers'], queryFn: () => api.get<Customer[]>('/customers?includeInactive=true') });
  const [editing, setEditing] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader title="Customers" subtitle="Bill-to details, markup defaults & rate schedules"
        actions={<>
          <a className="btn-ghost" href="/api/customers/export/csv">Export CSV</a>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New Customer</button>
        </>} />
      {isLoading ? <Skeleton /> : !data?.length ? <Empty title="No customers yet" /> : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr><th className="th">Name</th><th className="th">City</th><th className="th">Jobs</th><th className="th">Materials markup</th><th className="th">Status</th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-paper" onClick={() => setEditing(c)}>
                  <td className="td font-medium">{c.name}</td>
                  <td className="td">{c.billToCity || '—'}</td>
                  <td className="td">{c.job_count}</td>
                  <td className="td">{c.markups.materials != null ? formatPercent(c.markups.materials) : <span className="text-muted">inherits 15%</span>}</td>
                  <td className="td">{c.active ? <Badge status="finalized">active</Badge> : <Badge status="void">inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <CustomerForm onClose={() => setCreating(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['customers'] }); setCreating(false); }} />}
      {editing && <CustomerDrawer customer={editing} onClose={() => setEditing(null)} onChanged={() => qc.invalidateQueries({ queryKey: ['customers'] })} />}
    </div>
  );
}

function CustomerForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', bill_to_address1: '', bill_to_address2: '', bill_to_city: '', bill_to_state: '', bill_to_zip: '', contact_name: '', contact_email: '', contact_phone: '' });
  const m = useMutation({ mutationFn: () => api.post('/customers', f), onSuccess: () => { toast('Customer created'); onSaved(); }, onError: (e: any) => toast(e.message, 'err') });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title="New Customer">
      <div className="space-y-3">
        <div><label className="label">Name</label><input className="input" value={f.name} onChange={set('name')} /></div>
        <div><label className="label">Address</label><input className="input" value={f.bill_to_address1} onChange={set('bill_to_address1')} /></div>
        <div><label className="label">Address line 2</label><input className="input" value={f.bill_to_address2} onChange={set('bill_to_address2')} /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><label className="label">City</label><input className="input" value={f.bill_to_city} onChange={set('bill_to_city')} /></div>
          <div><label className="label">State</label><input className="input" value={f.bill_to_state} onChange={set('bill_to_state')} /></div>
          <div><label className="label">Zip</label><input className="input" value={f.bill_to_zip} onChange={set('bill_to_zip')} /></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div><label className="label">Contact name</label><input className="input" value={f.contact_name} onChange={set('contact_name')} /></div>
          <div><label className="label">Contact email</label><input className="input" value={f.contact_email} onChange={set('contact_email')} /></div>
          <div><label className="label">Contact phone</label><input className="input" value={f.contact_phone} onChange={set('contact_phone')} /></div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => m.mutate()} disabled={!f.name || m.isPending}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function CustomerDrawer({ customer, onClose, onChanged }: { customer: Customer; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<'profile' | 'markups' | 'schedules'>('profile');
  return (
    <Modal open onClose={onClose} title={customer.name} wide>
      <div className="mb-4 flex gap-2 border-b border-line">
        {(['profile', 'schedules', 'markups'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm font-medium capitalize ${tab === t ? 'border-b-2 border-copper text-copper' : 'text-muted'}`}>{t}</button>
        ))}
      </div>
      {tab === 'profile' ? <ProfileTab customer={customer} onChanged={onChanged} /> : tab === 'markups' ? <MarkupsTab customer={customer} onChanged={onChanged} /> : <SchedulesTab customer={customer} />}
    </Modal>
  );
}

function ProfileTab({ customer, onChanged }: { customer: Customer; onChanged: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['customer', customer.id], queryFn: () => api.get<any>(`/customers/${customer.id}`) });
  const [f, setF] = useState<any>(null);
  if (data && !f) {
    setF({
      name: data.name ?? '', bill_to_address1: data.billToAddress1 ?? '', bill_to_address2: data.billToAddress2 ?? '',
      bill_to_city: data.billToCity ?? '', bill_to_state: data.billToState ?? '', bill_to_zip: data.billToZip ?? '',
      contact_name: data.contactName ?? '', contact_email: data.contactEmail ?? '', contact_phone: data.contactPhone ?? '',
      active: data.active ?? true,
    });
  }
  const m = useMutation({
    mutationFn: () => api.put(`/customers/${customer.id}`, f),
    onSuccess: () => { toast('Customer saved'); onChanged(); },
    onError: (e: any) => toast(e.message, 'err'),
  });
  if (isLoading || !f) return <Skeleton rows={5} />;
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-3">
      <div><label className="label">Name</label><input className="input" value={f.name} onChange={set('name')} /></div>
      <div><label className="label">Bill-to address</label><input className="input" value={f.bill_to_address1} onChange={set('bill_to_address1')} /></div>
      <div><label className="label">Address line 2</label><input className="input" value={f.bill_to_address2} onChange={set('bill_to_address2')} /></div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="label">City</label><input className="input" value={f.bill_to_city} onChange={set('bill_to_city')} /></div>
        <div><label className="label">State</label><input className="input" value={f.bill_to_state} onChange={set('bill_to_state')} /></div>
        <div><label className="label">Zip</label><input className="input" value={f.bill_to_zip} onChange={set('bill_to_zip')} /></div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="label">Contact name</label><input className="input" value={f.contact_name} onChange={set('contact_name')} /></div>
        <div><label className="label">Contact email</label><input className="input" value={f.contact_email} onChange={set('contact_email')} placeholder="used as default invoice recipient" /></div>
        <div><label className="label">Contact phone</label><input className="input" value={f.contact_phone} onChange={set('contact_phone')} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
      <button className="btn-primary" onClick={() => m.mutate()} disabled={!f.name || m.isPending}>Save profile</button>
    </div>
  );
}

function MarkupsTab({ customer, onChanged }: { customer: Customer; onChanged: () => void }) {
  const [map, setMap] = useState<Record<string, string>>(Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, customer.markups[c] != null ? String(customer.markups[c] * 100) : ''])));
  const m = useMutation({
    mutationFn: () => api.put(`/customers/${customer.id}/markups`, EXPENSE_CATEGORIES.filter((c) => map[c] !== '').map((c) => ({ category: c, percent: Number(map[c]) / 100 }))),
    onSuccess: () => { toast('Markups saved'); onChanged(); },
  });
  return (
    <div className="space-y-2">
      {EXPENSE_CATEGORIES.map((c) => (
        <div key={c} className="flex items-center gap-3">
          <div className="w-40 text-sm">{EXPENSE_CATEGORY_LABELS[c]}</div>
          <input className="input w-28" placeholder="inherit" value={map[c]} onChange={(e) => setMap({ ...map, [c]: e.target.value })} />
          <span className="text-sm text-muted">%</span>
        </div>
      ))}
      <button className="btn-primary mt-3" onClick={() => m.mutate()} disabled={m.isPending}>Save markups</button>
    </div>
  );
}

interface Schedule { id: string; name: string; effectiveFrom: string; effectiveTo: string | null; lineCount: number; }
function SchedulesTab({ customer }: { customer: Customer }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['schedules', customer.id], queryFn: () => api.get<Schedule[]>(`/customers/${customer.id}/rate-schedules`) });
  const [editing, setEditing] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<Schedule>(`/customers/${customer.id}/rate-schedules`, { name: `Schedule ${new Date().getFullYear()}`, effective_from: `${new Date().getFullYear()}-01-01` }),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ['schedules', customer.id] }); setEditing(s.id); },
    onError: (e: any) => toast(e.message, 'err'),
  });
  if (editing) return <ScheduleEditor scheduleId={editing} onBack={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['schedules', customer.id] }); }} customerId={customer.id} />;
  return (
    <div>
      <button className="btn-primary mb-3" onClick={() => create.mutate()}><Plus size={16} /> New Schedule</button>
      {!data?.length ? <Empty title="No schedules — create one to set bill rates" /> : (
        <div className="space-y-2">
          {data.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-lg border border-line p-3">
              <div><div className="font-medium">{s.name}</div><div className="text-xs text-muted">{s.effectiveFrom} → {s.effectiveTo ?? 'open'} · {s.lineCount} lines</div></div>
              <button className="btn-ghost" onClick={() => setEditing(s.id)}>Edit rates</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Level { id: string; name: string; }
function ScheduleEditor({ scheduleId, customerId, onBack }: { scheduleId: string; customerId: string; onBack: () => void }) {
  const { data: levels } = useQuery({ queryKey: ['rate-levels'], queryFn: () => api.get<Level[]>('/rate-levels') });
  const { data: sched } = useQuery({ queryKey: ['schedule', scheduleId], queryFn: () => api.get<any>(`/rate-schedules/${scheduleId}`) });
  const [rows, setRows] = useState<Record<string, { rate_1x: string; rate_15x: string; rate_2x: string }>>({});
  const init = () => {
    if (!levels) return {};
    const existing = new Map((sched?.lines ?? []).map((l: any) => [l.levelId, l]));
    return Object.fromEntries(levels.map((l) => {
      const e: any = existing.get(l.id);
      return [l.id, { rate_1x: e ? String(e.rate1x) : '', rate_15x: e ? String(e.rate15x) : '', rate_2x: e ? String(e.rate2x) : '' }];
    }));
  };
  const [loaded, setLoaded] = useState(false);
  if (levels && sched && !loaded) { setRows(init()); setLoaded(true); }
  const save = useMutation({
    mutationFn: () => api.post(`/rate-schedules/${scheduleId}/lines/bulk`, Object.entries(rows).filter(([, v]) => v.rate_1x !== '').map(([level_id, v]) => ({ level_id, rate_1x: Number(v.rate_1x), rate_15x: Number(v.rate_15x || v.rate_1x), rate_2x: Number(v.rate_2x || v.rate_1x) }))),
    onSuccess: async () => { await api.put(`/rate-schedules/${scheduleId}/set-default`); toast('Rates saved & set as default'); },
    onError: (e: any) => toast(e.message, 'err'),
  });
  void customerId; void formatMoney;
  return (
    <div>
      <button className="btn-ghost mb-3" onClick={onBack}>← Back</button>
      <table className="w-full">
        <thead><tr><th className="th">Level</th><th className="th">1× (ST)</th><th className="th">1.5× (OT)</th><th className="th">2× (DT)</th></tr></thead>
        <tbody>
          {levels?.map((l) => (
            <tr key={l.id}>
              <td className="td">{l.name}</td>
              {(['rate_1x', 'rate_15x', 'rate_2x'] as const).map((k) => (
                <td key={k} className="td"><input className="input w-24" value={rows[l.id]?.[k] ?? ''} onChange={(e) => setRows({ ...rows, [l.id]: { ...rows[l.id], [k]: e.target.value } })} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn-primary mt-3" onClick={() => save.mutate()} disabled={save.isPending}>Save rates</button>
    </div>
  );
}
