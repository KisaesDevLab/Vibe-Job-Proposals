import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@darrow/shared';
import { PageHeader } from '@/components/Layout';
import { Modal, Skeleton, Empty, Badge, toast } from '@/components/ui';
import { SearchSelect } from '@/components/SearchSelect';
import { SortableHeader, nextSort, compareValues, type SortState } from '@/components/SortableHeader';

interface Level { id: string; name: string; }
interface Employee { id: string; name: string; levelName: string; levelId: string; active: boolean; hireDate: string | null; notes: string | null; current_rate: { costSt: string; costOt: string; costDt: string } | null; }

type SortKey = 'name' | 'level' | 'cost' | 'status';

export function EmployeesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['employees'], queryFn: () => api.get<Employee[]>('/employees?includeInactive=true') });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [rateFor, setRateFor] = useState<Employee | null>(null);
  const [levelFor, setLevelFor] = useState<Employee | null>(null);

  // Filters
  const [nameQ, setNameQ] = useState('');
  const [levelF, setLevelF] = useState(''); // '' = all
  const [statusF, setStatusF] = useState<'all' | 'active' | 'inactive'>('active');
  const [costF, setCostF] = useState<'all' | 'set' | 'missing'>('all');
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'name', dir: 'asc' });

  // Unique levels from the current dataset for the dropdown
  const levelOptions = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const e of data) if (!seen.has(e.levelName)) { seen.add(e.levelName); out.push({ value: e.levelName, label: e.levelName }); }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = nameQ.trim().toLowerCase();
    return data.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (levelF && e.levelName !== levelF) return false;
      if (statusF === 'active' && !e.active) return false;
      if (statusF === 'inactive' && e.active) return false;
      const r = e.current_rate;
      const hasCost = !!r && (Number(r.costSt) > 0 || Number(r.costOt) > 0 || Number(r.costDt) > 0);
      if (costF === 'set' && !hasCost) return false;
      if (costF === 'missing' && hasCost) return false;
      return true;
    });
  }, [data, nameQ, levelF, statusF, costF]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      const k = sort.key;
      if (k === 'name') return compareValues(a.name, b.name, sort.dir);
      if (k === 'level') return compareValues(a.levelName, b.levelName, sort.dir);
      if (k === 'status') return compareValues(a.active ? 0 : 1, b.active ? 0 : 1, sort.dir);
      // cost = sum of ST+OT+DT for a stable numeric sort
      const av = a.current_rate ? Number(a.current_rate.costSt) + Number(a.current_rate.costOt) + Number(a.current_rate.costDt) : -1;
      const bv = b.current_rate ? Number(b.current_rate.costSt) + Number(b.current_rate.costOt) + Number(b.current_rate.costDt) : -1;
      return compareValues(av, bv, sort.dir);
    });
    return rows;
  }, [filtered, sort]);

  return (
    <div>
      <PageHeader title="Employees" subtitle="Active crew & effective-dated cost rates"
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New Employee</button>} />
      {isLoading ? <Skeleton /> : !data?.length ? <Empty title="No employees yet" hint="Add your first employee" /> : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <SortableHeader<SortKey> label="Name"  sortKey="name"   sort={sort} onSort={(k) => setSort((p) => nextSort(p, k))} />
                <SortableHeader<SortKey> label="Level" sortKey="level"  sort={sort} onSort={(k) => setSort((p) => nextSort(p, k))} />
                <SortableHeader<SortKey> label="Cost ST/OT/DT" sortKey="cost" sort={sort} onSort={(k) => setSort((p) => nextSort(p, k))} />
                <SortableHeader<SortKey> label="Status" sortKey="status" sort={sort} onSort={(k) => setSort((p) => nextSort(p, k))} />
                <th className="th"></th>
              </tr>
              <tr className="bg-paper/40">
                <th className="th py-1.5"><input className="input" placeholder="Search name…" value={nameQ} onChange={(e) => setNameQ(e.target.value)} /></th>
                <th className="th py-1.5">
                  <SearchSelect value={levelF} onChange={setLevelF} options={[{ value: '', label: 'All levels' }, ...levelOptions]} placeholder="All levels" />
                </th>
                <th className="th py-1.5">
                  <SearchSelect value={costF} onChange={(v) => setCostF(v as typeof costF)} options={[{ value: 'all', label: 'Any cost' }, { value: 'set', label: 'Has cost rate' }, { value: 'missing', label: 'Missing/zero' }]} />
                </th>
                <th className="th py-1.5">
                  <SearchSelect value={statusF} onChange={(v) => setStatusF(v as typeof statusF)} options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active only' }, { value: 'inactive', label: 'Inactive only' }]} />
                </th>
                <th className="th py-1.5 text-right text-xs text-muted">{sorted.length} of {data.length}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td className="td text-muted" colSpan={5}>No employees match the current filters</td></tr>
              ) : sorted.map((e) => {
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

interface CostRateRow { id: string; effectiveFrom: string; effectiveTo: string | null; costSt: string; costOt: string; costDt: string; }

function EmployeeEditForm({ emp, onClose, onSaved }: { emp: Employee; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
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
  const { data: rates } = useQuery({
    queryKey: ['employee-cost-rates', emp.id],
    queryFn: () => api.get<CostRateRow[]>(`/employees/${emp.id}/cost-rates`),
  });
  const del = useMutation({
    mutationFn: (rateId: string) => api.del(`/employees/${emp.id}/cost-rates/${rateId}`),
    onSuccess: () => {
      toast('Cost rate deleted');
      qc.invalidateQueries({ queryKey: ['employee-cost-rates', emp.id] });
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e: any) => toast(e.message ?? String(e), 'err'),
  });
  const fmtMoney = (s: string) => `$${Number(s ?? 0).toFixed(2)}`;
  return (
    <Modal open onClose={onClose} title={`Edit Employee — ${emp.name}`} wide>
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

        <div>
          <label className="label">Cost rate history</label>
          {!rates ? <Skeleton rows={2} /> : rates.length === 0 ? (
            <p className="text-sm text-muted">No cost rate set yet — use the "New rate" button on the employee row.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-paper/60 text-xs">
                  <tr>
                    <th className="th">From</th>
                    <th className="th">To</th>
                    <th className="th text-right">ST</th>
                    <th className="th text-right">OT</th>
                    <th className="th text-right">DT</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r) => (
                    <tr key={r.id}>
                      <td className="td">{r.effectiveFrom}</td>
                      <td className="td">{r.effectiveTo ?? <span className="text-finalized">open</span>}</td>
                      <td className="td text-right">{fmtMoney(r.costSt)}</td>
                      <td className="td text-right">{fmtMoney(r.costOt)}</td>
                      <td className="td text-right">{fmtMoney(r.costDt)}</td>
                      <td className="td text-right">
                        <button
                          className="btn-ghost text-red text-xs"
                          onClick={() => {
                            if (confirm(`Delete cost rate ${r.effectiveFrom} → ${r.effectiveTo ?? 'open'}?\n\nIf this row covered any time entries, future finalize for those entries will block with "no cost rate" until a replacement is added.`)) {
                              del.mutate(r.id);
                            }
                          }}
                          disabled={del.isPending}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

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
