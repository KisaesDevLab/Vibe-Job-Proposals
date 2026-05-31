import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, LayoutGrid, User } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { Skeleton, Empty, Modal, toast } from '@/components/ui';

const TIERS = ['st', 'ot', 'dt'] as const;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function mondayOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Mon=0
  x.setUTCDate(x.getUTCDate() - dow);
  return x.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

interface Day { id: string; date: string; st: number; ot: number; dt: number; invoice_id: string | null; }
interface JobRow { job_id: string; job_code: string; days: Day[]; }
interface EmpRow { employee_id: string; employee_name: string; jobs: JobRow[]; }

// Atomic single-cell save: the server reads the other two tiers under a row lock
// and merges, so rapid edits to sibling tiers can't clobber each other. Returns
// the server-normalized value for that tier (0 if the row was deleted), or null
// on error.
async function saveCell(employee_id: string, job_id: string, date: string, tier: string, value: number): Promise<number | null> {
  try {
    const r: any = await api.post('/time/cell', { employee_id, job_id, work_date: date, tier, hours: value });
    if (r?.deleted) return 0;
    return Number(r?.[`${tier}_hours`]) || 0;
  } catch (e: any) {
    toast(e.message, 'err');
    return null;
  }
}

export function TimePage() {
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const [mode, setMode] = useState<'crew' | 'employee'>('crew');

  return (
    <div>
      <PageHeader title="Time" subtitle={`Week of ${weekStart}`}
        actions={
          <div className="flex items-center gap-2">
            <div className="mr-1 flex rounded-lg border border-line bg-card p-0.5">
              <button onClick={() => setMode('crew')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm ${mode === 'crew' ? 'bg-copper text-white' : 'text-muted'}`}><LayoutGrid size={15} /> All Crew</button>
              <button onClick={() => setMode('employee')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm ${mode === 'employee' ? 'bg-copper text-white' : 'text-muted'}`}><User size={15} /> By Employee</button>
            </div>
            <button className="btn-ghost" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={16} /></button>
            <button className="btn-ghost" onClick={() => setWeekStart(mondayOf(new Date()))}>Today</button>
            <button className="btn-ghost" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={16} /></button>
          </div>
        } />
      {mode === 'crew' ? <CrewGrid weekStart={weekStart} /> : <EmployeeWeek weekStart={weekStart} />}
    </div>
  );
}

// Excel-like weekly grid: controlled cells with a local "edits" overlay so
// saving/refetching never remounts an input (focus is preserved), plus keyboard
// navigation — Tab/Shift+Tab across columns, Enter/Arrow-Down to move down,
// Arrow-Up to move up, and select-on-focus so you can type without clicking.
function WeekTable({ weekStart, rows, onChanged, showEmployee }: { weekStart: string; rows: EmpRow[]; employeeId?: string; onChanged: () => void; showEmployee: boolean }) {
  const dates = useMemo(() => DAYS.map((_, i) => addDays(weekStart, i)), [weekStart]);
  const totalCols = dates.length * TIERS.length;
  const [edits, setEdits] = useState<Record<string, string>>({});
  useEffect(() => setEdits({}), [weekStart]); // drop typed overrides when the week changes
  const refs = useRef<Map<string, HTMLInputElement>>(new Map());
  const reconcileTimer = useRef<number | undefined>();

  // Flatten employee→job into navigable rows (in DOM order).
  const flat = useMemo(
    () => rows.flatMap((emp) => emp.jobs.map((job, ji) => ({ emp, job, firstOfEmp: ji === 0 }))),
    [rows],
  );

  const cellKey = (e: string, j: string, d: string, t: string) => `${e}|${j}|${d}|${t}`;
  const valueOf = (days: Day[] | undefined, e: string, j: string, d: string, t: 'st' | 'ot' | 'dt') => {
    const k = cellKey(e, j, d, t);
    if (edits[k] !== undefined) return edits[k];
    const day = days?.find((x) => x.date === d);
    return day && day[t] ? String(day[t]) : '';
  };

  function focusCell(r: number, c: number) {
    if (r < 0 || r >= flat.length || c < 0 || c >= totalCols) return;
    const el = refs.current.get(`${r}:${c}`);
    if (el && !el.disabled) {
      el.focus();
      el.select();
    }
  }

  function scheduleReconcile() {
    window.clearTimeout(reconcileTimer.current);
    reconcileTimer.current = window.setTimeout(() => onChanged(), 1200);
  }

  async function commit(employee_id: string, job_id: string, date: string, t: string, raw: string, serverVal: number) {
    const v = Number(raw) || 0;
    if (v === serverVal) return;
    const saved = await saveCell(employee_id, job_id, date, t, v);
    if (saved !== null) {
      setEdits((prev) => ({ ...prev, [cellKey(employee_id, job_id, date, t)]: saved ? String(saved) : '' }));
      scheduleReconcile();
    }
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="th sticky left-0 bg-card">{showEmployee ? 'Employee / Job' : 'Job'}</th>
            {dates.map((d, i) => <th key={d} className="th text-center" colSpan={3}>{DAYS[i]}<div className="font-normal normal-case text-muted">{d.slice(5)}</div></th>)}
            <th className="th text-center">Total</th>
          </tr>
          <tr>
            <th className="th sticky left-0 bg-card"></th>
            {dates.map((d) => TIERS.map((t) => <th key={d + t} className="th text-center">{t.toUpperCase()}</th>))}
            <th className="th"></th>
          </tr>
        </thead>
        <tbody>
          {flat.map(({ emp, job, firstOfEmp }, r) => {
            const rowTotal = dates.reduce(
              (sum, d) => sum + TIERS.reduce((s, t) => s + (Number(valueOf(job.days, emp.employee_id, job.job_id, d, t)) || 0), 0),
              0,
            );
            return (
              <tr key={emp.employee_id + job.job_id}>
                <td className="td sticky left-0 bg-card">
                  {showEmployee && firstOfEmp && <div className="font-semibold">{emp.employee_name}</div>}
                  <div className="font-mono text-muted">{job.job_code}</div>
                </td>
                {dates.map((date, di) => {
                  const day = job.days.find((d) => d.date === date);
                  const locked = !!day?.invoice_id;
                  return TIERS.map((t, ti) => {
                    const c = di * TIERS.length + ti;
                    return (
                      <td key={date + t} className="border-t border-line p-0">
                        <input
                          ref={(el) => {
                            if (el) refs.current.set(`${r}:${c}`, el);
                            else refs.current.delete(`${r}:${c}`);
                          }}
                          className={`w-12 bg-transparent px-1 py-1.5 text-center outline-none focus:bg-copper-soft focus:ring-1 focus:ring-copper ${locked ? 'bg-paper text-muted' : ''}`}
                          inputMode="decimal"
                          value={valueOf(job.days, emp.employee_id, job.job_id, date, t)}
                          disabled={locked}
                          aria-label={`${emp.employee_name}, ${job.job_code}, ${DAYS[di]} ${t.toUpperCase()}`}
                          title={locked ? 'Billed — locked' : `${emp.employee_name}, ${job.job_code}, ${date} ${t.toUpperCase()}`}
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => setEdits((prev) => ({ ...prev, [cellKey(emp.employee_id, job.job_id, date, t)]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'ArrowDown') {
                              e.preventDefault();
                              focusCell(r + 1, c);
                            } else if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              focusCell(r - 1, c);
                            }
                            // Tab / Shift+Tab move across columns natively (skipping locked cells).
                          }}
                          onBlur={(e) => commit(emp.employee_id, job.job_id, date, t, e.currentTarget.value, day?.[t] ?? 0)}
                        />
                      </td>
                    );
                  });
                })}
                <td className="td text-center font-semibold">{rowTotal || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CrewGrid({ weekStart }: { weekStart: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['time', weekStart], queryFn: () => api.get<{ employees: EmpRow[] }>(`/time/week?week_start=${weekStart}`) });
  const [adding, setAdding] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['time', weekStart] });
  return (
    <div>
      <div className="mb-3 flex justify-end"><button className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Add row</button></div>
      {isLoading ? <Skeleton rows={6} /> : !data?.employees.length ? <Empty title="No time entries this week" hint="Add a row to start entering hours" /> : (
        <WeekTable weekStart={weekStart} rows={data.employees} onChanged={invalidate} showEmployee />
      )}
      {adding && <AddRow weekStart={weekStart} onClose={() => setAdding(false)} onAdded={() => { invalidate(); setAdding(false); }} />}
    </div>
  );
}

// Secondary mode: pick an employee, then enter job codes + hours for the week.
function EmployeeWeek({ weekStart }: { weekStart: string }) {
  const qc = useQueryClient();
  const { data: emps } = useQuery({ queryKey: ['employees'], queryFn: () => api.get<any[]>('/employees') });
  const [employeeId, setEmployeeId] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['time-emp', weekStart, employeeId],
    queryFn: () => api.get<{ employees: EmpRow[] }>(`/time/week?week_start=${weekStart}&employee_id=${employeeId}`),
    enabled: !!employeeId,
  });
  const [extraJobs, setExtraJobs] = useState<{ job_id: string; job_code: string }[]>([]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['time-emp', weekStart, employeeId] });

  const empName = emps?.find((e) => e.id === employeeId)?.name ?? '';
  // merge existing rows with locally-added empty job rows
  const base: EmpRow = data?.employees[0] ?? { employee_id: employeeId, employee_name: empName, jobs: [] };
  const existingIds = new Set(base.jobs.map((j) => j.job_id));
  const rows: EmpRow[] = employeeId
    ? [{ ...base, employee_id: employeeId, employee_name: empName, jobs: [...base.jobs, ...extraJobs.filter((j) => !existingIds.has(j.job_id)).map((j) => ({ ...j, days: [] }))] }]
    : [];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <select className="input max-w-xs" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setExtraJobs([]); }}>
          <option value="">Select an employee…</option>
          {emps?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {employeeId && <AddJobInline existing={new Set(rows[0]?.jobs.map((j) => j.job_id))} onAdd={(j) => setExtraJobs((p) => [...p, j])} />}
      </div>
      {!employeeId ? <Empty title="Select an employee to enter their week" /> : isLoading ? <Skeleton rows={5} /> : (
        rows[0].jobs.length === 0 ? <Empty title={`No jobs for ${empName} this week`} hint="Add a job code above to start entering hours" /> :
        <WeekTable weekStart={weekStart} rows={rows} onChanged={invalidate} showEmployee={false} />
      )}
    </div>
  );
}

function AddJobInline({ existing, onAdd }: { existing: Set<string>; onAdd: (j: { job_id: string; job_code: string }) => void }) {
  const { data: jobs } = useQuery({ queryKey: ['jobs-active'], queryFn: () => api.get<{ jobs: any[] }>('/jobs?active=true&pageSize=300') });
  const [val, setVal] = useState('');
  return (
    <select
      className="input max-w-xs"
      value={val}
      onChange={(e) => {
        const j = jobs?.jobs.find((x) => x.id === e.target.value);
        if (j && !existing.has(j.id)) onAdd({ job_id: j.id, job_code: j.code });
        setVal('');
      }}
    >
      <option value="">+ Add job code…</option>
      {jobs?.jobs.filter((j) => !existing.has(j.id)).map((j) => <option key={j.id} value={j.id}>{j.code} — {j.description}</option>)}
    </select>
  );
}

function AddRow({ weekStart, onClose, onAdded }: { weekStart: string; onClose: () => void; onAdded: () => void }) {
  const { data: emps } = useQuery({ queryKey: ['employees'], queryFn: () => api.get<any[]>('/employees') });
  const { data: jobs } = useQuery({ queryKey: ['jobs-active'], queryFn: () => api.get<{ jobs: any[] }>('/jobs?active=true&pageSize=300') });
  const [employee_id, setEmp] = useState('');
  const [job_id, setJob] = useState('');
  const [st, setSt] = useState('8');

  async function add() {
    try {
      await api.post('/time/entries', { employee_id, job_id, work_date: weekStart, st_hours: Number(st) || 0, ot_hours: 0, dt_hours: 0 });
      toast('Row added'); onAdded();
    } catch (e: any) { toast(e.message, 'err'); }
  }
  return (
    <Modal open onClose={onClose} title="Add Time Row">
      <div className="space-y-3">
        <div><label className="label">Employee</label><select className="input" value={employee_id} onChange={(e) => setEmp(e.target.value)}><option value="">Select…</option>{emps?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
        <div><label className="label">Job</label><select className="input" value={job_id} onChange={(e) => setJob(e.target.value)}><option value="">Select…</option>{jobs?.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.description}</option>)}</select></div>
        <div><label className="label">Monday ST hours (seed)</label><input className="input" value={st} onChange={(e) => setSt(e.target.value)} /><p className="mt-1 text-xs text-muted">Enter a positive number to create the row; you can edit the rest in the grid.</p></div>
        <div className="flex justify-end gap-2 pt-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={add} disabled={!employee_id || !job_id || !(Number(st) > 0)}>Add</button></div>
      </div>
    </Modal>
  );
}
