import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { Empty } from '@/components/ui';

const REPORTS = [
  { key: 'employee-hours', label: 'Hours by Employee' },
  { key: 'time-detail', label: 'Time Detail' },
  { key: 'expense-list', label: 'Expense List' },
] as const;

export function ReportsPage() {
  const { data: jobs } = useQuery({ queryKey: ['jobs'], queryFn: () => api.get<{ jobs: any[] }>('/jobs?pageSize=300') });
  const [report, setReport] = useState<string>('employee-hours');
  const [jobId, setJobId] = useState('');
  const { data, isFetching } = useQuery({
    queryKey: ['report', report, jobId],
    queryFn: () => api.get<any[]>(`/reports/${report}?job_id=${jobId}`),
    enabled: !!jobId,
  });
  return (
    <div>
      <PageHeader title="Reports" subtitle="Hours & expense breakdowns by job/invoice" />
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="input max-w-xs" value={report} onChange={(e) => setReport(e.target.value)}>
          {REPORTS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <select className="input max-w-xs" value={jobId} onChange={(e) => setJobId(e.target.value)}>
          <option value="">Select job…</option>
          {jobs?.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.description}</option>)}
        </select>
        {jobId && <a className="btn-ghost" href={`/api/reports/${report}?job_id=${jobId}&format=csv`}><Download size={15} /> CSV</a>}
      </div>
      {!jobId ? <Empty title="Select a job to run a report" /> : isFetching ? <Empty title="Loading…" /> : !data?.length ? <Empty title="No data for this job" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>{Object.keys(data[0]).map((k) => <th key={k} className="th">{k}</th>)}</tr></thead>
            <tbody>{data.map((row, i) => <tr key={i}>{Object.values(row).map((v: any, j) => <td key={j} className="td">{String(v ?? '')}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
