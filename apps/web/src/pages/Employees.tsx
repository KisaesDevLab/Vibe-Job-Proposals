import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@darrow/shared';
import { PageHeader } from '@/components/Layout';
import { Modal, Skeleton, Empty, Badge, toast } from '@/components/ui';
import { SearchSelect } from '@/components/SearchSelect';

interface Level { id: string; name: string; }
interface Employee { id: string; name: string; levelName: string; levelId: string; active: boolean; hireDate: string | null; notes: string | null; current_rate: { costSt: string; costOt: string; costDt: string } | null; }

export function EmployeesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['employees'], queryFn: () => api.get<Employee[]>('/employees?includeInactive=true') });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [rateFor, setRateFor] = useState<Employee | null>(null);
  const [levelFor, setLevelFor] = useState<Employee | null>(null);
  return (
    <div>
      <PageHeader title="Employees" subtitle="Active crew & effective-dated cost rates"
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New Employee</button>} />
      {isLoading ? <Skeleton /> : !data?.length ? <Empty title="No employees yet" hint="Add your first employee" /> : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr><th className="th">Name</th><th className="th">Level</th><th className="th">Cost ST/OT/DT</th><th className="th">Status</th><th className="th"></th></tr></thead>
            <tbody>
              {data.map((e) => {
                const r = e.current_rate;
                const hasCost = r && (Number(r.costSt) > 0 || Number(r.costOt) > 0 || Number(r.costDt) > 0);
                return (
                  <tr key={e.id} className="cursor-pointer hover:bg-paper" onClick={() => setEditing(e)}>
                    <td className="td font-medium">{e.name}</td>
                    <td className="td">{e.levelName}</td>
                    <td className="td">{r ? <span className={hasCost ? '' : 'text-red'}>{formatMoney(r.costSt)} / {formatMoney(r.costOt)} / {formatMoney(r.costDt)}</span> : <span className="text-red">no cost rate</span>}</td>
                    <td className="td">{e.active ? <Badge status="finalized">active</Badge> : <Badge status="void">inactive</Badge>}</td>
                    <td className="td text-right">
                      <button className="btn-ghost" onClick={(ev) => { ev.stopPropagation(); setLevelFor(e); }}>Change level</button>
                      <button className="btn-ghost ml-1" onClick={(ev) => { ev.stopPropagation(); setRateFor(e); }}>New rate</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && <EmployeeForm onClose={() => setCreating(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['employees'] }); setCreating(false); }} />}
      {editing && <EmployeeEditForm emp={editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['employees'] }); setEditing(null); }} />}
      {rateFor && <RateForm emp={rateFor} onClose={() => setRateFor(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['employees'] }); setRateFor(null); }} />}
      {levelFor && <LevelForm emp={levelFor} onClose={() => setLevelFor(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['employees'] }); setLevelFor(null); }} />}
    </div>
  );
}

interface LevelHistoryRow { id: string; level_id: string; level_name: string; effective_from: string; effective_to: string | null; }

function LevelForm({ emp, onClose, onSaved }: { emp: Employee; onClose: () => void; onSaved: () => void }) {
  const { data: levels } = useQuery({ queryKey: ['rate-levels'], queryFn: () => api.get<Level[]>('/rate-levels') });
  const { data: history } = useQuery({ queryKey: ['employee-levels', emp.id], queryFn: () => api.get<LevelHistoryRow[]>(`/employees/${emp.id}/levels`) });
  // Default effective_from to today's Monday in LOCAL time (Sunday-evening
  // Central time would otherwise jump a week ahead under UTC).
  const mondayOf = (d: Date) => {
    const dow = (d.getDay() + 6) % 7;
    const local = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
    const m = String(local.getMonth() + 1).padStart(2, '0');
    const day = String(local.getDate()).padStart(2, '0');
    return `${local.getFullYear()}-${m}-${day}`;
  };
  const [f, setF] = useState({ effective_from: mondayOf(new Date()), level_id: '' });
  const m = useMutation({
    mutationFn: () => api.post(`/employees/${emp.id}/levels`, f),
    onSuccess: () => { toast('Level updated'); onSaved(); },
    onError: (e: any) => toast(e.message, 'err'),
  });
  return (
    <Modal open onClose={onClose} title={`Change Level — ${emp.name}`}>
      <div className="space-y-3">
        <div><label className="label">Effective from</label><input type="date" className="input" value={f.effective_from} onChange={(e) => setF({ ...f, effective_from: e.target.value })} /></div>
        <div><label className="label">New level</label>
          <SearchSelect
            value={f.level_id}
            onChange={(v) => setF({ ...f, level_id: v })}
            options={(levels ?? []).map((l) => ({ value: l.id, label: l.name }))}
            placeholder="Select…"
          />
        </div>
        <p className="text-xs text-muted">Time entries dated before this date keep the previous level's bill rate. Promotions and demotions are tracked over time.</p>
        {history && history.length > 0 && (
          <div className="rounded-lg border border-line p-2">
            <div className="mb-1 text-xs font-semibold text-muted">History</div>
            <ul className="space-y-0.5 text-xs">
              {history.map((h) => (
                <li key={h.id} className="flex justify-between">
                  <span className="font-mono">{h.effective_from} → {h.effective_to ?? 'open'}</span>
                  <span>{h.level_name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => m.mutate()} disabled={!f.level_id || m.isPending}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function EmployeeEditForm({ emp, onClose, onSaved }: { emp: Employee; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: emp.name,
    active: emp.active,
    hire_date: emp.hireDate ?? '',
    notes: emp.notes ?? '',
  });
  const m = useMutation({
    mutationFn: () => api.put(`/employees/${emp.id}`, { ...f, hire_date: f.hire_date || null, notes: f.notes || null }),
    onSuccess: () => { toast('Employee updated'); onSaved(); },
    onError: (e: any) => toast(e.message, 'err'),
  });
  return (
    <Modal open onClose={onClose} title={`Edit Employee — ${emp.name}`}>
      <div className="space-y-3">
        <div><label className="label">Name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div>
          <label className="label">Current rate level</label>
          <div className="rounded-lg border border-line bg-paper/50 px-3 py-2 text-sm">{emp.levelName}</div>
          <p className="mt-1 text-xs text-muted">Use the <b>Change level</b> action on the employee row to promote/demote (effective-dated; doesn't affect past time entries).</p>
        </div>
        <div><label className="label">Hire date</label><input type="date" className="input" value={f.hire_date} onChange={(e) => setF({ ...f, hire_date: e.target.value })} /></div>
        <div><label className="label">Notes</label><textarea className="input" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          <span>{f.active ? 'Active' : 'Inactive'} <span className="text-muted">— inactive employees hidden from new time/expense pickers</span></span>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => m.mutate()} disabled={!f.name || m.isPending}>Save changes</button>
        </div>
      </div>
    </Modal>
  );
}

function EmployeeForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: levels } = useQuery({ queryKey: ['rate-levels'], queryFn: () => api.get<Level[]>('/rate-levels') });
  const [name, setName] = useState('');
  const [levelId, setLevelId] = useState('');
  const m = useMutation({ mutationFn: () => api.post('/employees', { name, level_id: levelId }), onSuccess: () => { toast('Employee created'); onSaved(); }, onError: (e: any) => toast(e.message, 'err') });
  return (
    <Modal open onClose={onClose} title="New Employee">
      <div className="space-y-3">
        <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label">Rate level</label>
          <SearchSelect
            value={levelId}
            onChange={setLevelId}
            options={(levels ?? []).map((l) => ({ value: l.id, label: l.name }))}
            placeholder="Select…"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => m.mutate()} disabled={!name || !levelId || m.isPending}>Save</button></div>
      </div>
    </Modal>
  );
}

function RateForm({ emp, onClose, onSaved }: { emp: Employee; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ effective_from: new Date().toISOString().slice(0, 10), cost_st: '', cost_ot: '', cost_dt: '' });
  const m = useMutation({ mutationFn: () => api.post(`/employees/${emp.id}/cost-rates`, { effective_from: f.effective_from, cost_st: Number(f.cost_st), cost_ot: Number(f.cost_ot), cost_dt: Number(f.cost_dt) }), onSuccess: () => { toast('Cost rate added'); onSaved(); }, onError: (e: any) => toast(e.message, 'err') });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title={`New Cost Rate — ${emp.name}`}>
      <div className="space-y-3">
        <div><label className="label">Effective from</label><input type="date" className="input" value={f.effective_from} onChange={set('effective_from')} /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><label className="label">Cost ST</label><input className="input" value={f.cost_st} onChange={set('cost_st')} /></div>
          <div><label className="label">Cost OT</label><input className="input" value={f.cost_ot} onChange={set('cost_ot')} /></div>
          <div><label className="label">Cost DT</label><input className="input" value={f.cost_dt} onChange={set('cost_dt')} /></div>
        </div>
        <p className="text-xs text-muted">Closes the current open rate as of {f.effective_from}.</p>
        <div className="flex justify-end gap-2 pt-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => m.mutate()} disabled={m.isPending}>Save</button></div>
      </div>
    </Modal>
  );
}
