import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
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

export function TimePage() {
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const { data, isLoading } = useQuery({ queryKey: ['time', weekStart], queryFn: () => api.get<{ employees: EmpRow[] }>(`/time/week?week_start=${weekStart}`) });
  const [adding, setAdding] = useState(false);

  async function saveCell(employee_id: string, job_id: string, date: string, tier: string, value: number, day: Day | undefined) {
    const body = { employee_id, job_id, work_date: date, st_hours: day?.st ?? 0, ot_hours: day?.ot ?? 0, dt_hours: day?.dt ?? 0, [`${tier}_hours`]: value };
    try {
      await api.post('/time/entries', body);
      qc.invalidateQueries({ queryKey: ['time', weekStart] });
    } catch (e: any) { toast(e.message, 'err'); }
  }

  const dates = DAYS.map((_, i) => addDays(weekStart, i));

  return (
    <div>
      <PageHeader title="Time Grid" subtitle={`Week of ${weekStart}`}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={16} /></button>
            <button className="btn-ghost" onClick={() => setWeekStart(mondayOf(new Date()))}>Today</button>
            <button className="btn-ghost" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={16} /></button>
            <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Add row</button>
          </div>
        } />
      {isLoading ? <Skeleton rows={6} /> : !data?.employees.length ? <Empty title="No time entries this week" hint="Add a row to start entering hours" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="th sticky left-0 bg-card">Employee / Job</th>
                {dates.map((d, i) => <th key={d} className="th text-center" colSpan={3}>{DAYS[i]}<div className="font-normal normal-case text-muted">{d.slice(5)}</div></th>)}
              </tr>
              <tr>
                <th className="th sticky left-0 bg-card"></th>
                {dates.map((d) => TIERS.map((t) => <th key={d + t} className="th text-center">{t.toUpperCase()}</th>))}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((emp) => emp.jobs.map((job, ji) => (
                <tr key={emp.employee_id + job.job_id}>
                  <td className="td sticky left-0 bg-card">
                    {ji === 0 && <div className="font-semibold">{emp.employee_name}</div>}
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
                          title={locked ? 'Billed — locked' : `${emp.employee_name}, ${job.job_code}, ${date} ${t.toUpperCase()}`}
                          onBlur={(e) => {
                            const v = Number(e.target.value) || 0;
                            if (v !== (day?.[t] ?? 0)) saveCell(emp.employee_id, job.job_id, date, t, v, day);
                          }}
                        />
                      </td>
                    ));
                  })}
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddRow weekStart={weekStart} onClose={() => setAdding(false)} onAdded={() => { qc.invalidateQueries({ queryKey: ['time', weekStart] }); setAdding(false); }} />}
    </div>
  );
}

function AddRow({ weekStart, onClose, onAdded }: { weekStart: string; onClose: () => void; onAdded: () => void }) {
  const { data: emps } = useQuery({ queryKey: ['employees'], queryFn: () => api.get<any[]>('/employees') });
  const { data: jobs } = useQuery({ queryKey: ['jobs'], queryFn: () => api.get<{ jobs: any[] }>('/jobs?active=true&pageSize=200') });
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
