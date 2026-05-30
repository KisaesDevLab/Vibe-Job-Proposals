import { useState } from 'react';
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

async function saveCell(employee_id: string, job_id: string, date: string, tier: string, value: number, day: Day | undefined): Promise<boolean> {
  const body = { employee_id, job_id, work_date: date, st_hours: day?.st ?? 0, ot_hours: day?.ot ?? 0, dt_hours: day?.dt ?? 0, [`${tier}_hours`]: value };
  try {
    await api.post('/time/entries', body);
    return true;
  } catch (e: any) {
    toast(e.message, 'err');
    return false;
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

function WeekTable({ weekStart, rows, onChanged, showEmployee }: { weekStart: string; rows: EmpRow[]; employeeId?: string; onChanged: () => void; showEmployee: boolean }) {
  const dates = DAYS.map((_, i) => addDays(weekStart, i));
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
          {rows.map((emp) => emp.jobs.map((job, ji) => {
            const rowTotal = job.days.reduce((a, d) => a + d.st + d.ot + d.dt, 0);
            return (
              <tr key={emp.employee_id + job.job_id}>
                <td className="td sticky left-0 bg-card">
                  {showEmployee && ji === 0 && <div className="font-semibold">{emp.employee_name}</div>}
                  <div className="font-mono text-muted">{job.job_code}</div>
                </td>
                {dates.map((date) => {
                  const day = job.days.find((d) => d.date === date);
                  const locked = !!day?.invoice_id;
                  return TIERS.map((t) => (
                    <td key={date + t} className="border-t border-line p-0">
                      <input
                        className={`w-12 bg-transparent px-1 py-1.5 text-center outline-none focus:bg-copper-soft ${locked ? 'bg-paper text-muted' : ''}`}
                        defaultValue={day?.[t] || ''}
                        disabled={locked}
                        aria-label={`${emp.employee_name}, ${job.job_code}, ${DAYS[dates.indexOf(date)]} ${t.toUpperCase()}`}
                        title={locked ? 'Billed — locked' : `${emp.employee_name}, ${job.job_code}, ${date} ${t.toUpperCase()}`}
                        onBlur={async (e) => {
                          const v = Number(e.target.value) || 0;
                          if (v !== (day?.[t] ?? 0)) { if (await saveCell(emp.employee_id, job.job_id, date, t, v, day)) onChanged(); }
                        }}
                      />
                    </td>
                  ));
                })}
                <td className="td text-center font-semibold">{rowTotal || ''}</td>
              </tr>
            );
          }))}
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
        <div><label className="label">Monday ST hours (seed)</label><input className="input" value={st} onChange={(e) => setSt(e.target.value)} /></div>
        <div className="flex justify-end gap-2 pt-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={add} disabled={!employee_id || !job_id}>Add</button></div>
      </div>
    </Modal>
  );
}
