import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { Empty } from '@/components/ui';
import { SearchSelect } from '@/components/SearchSelect';

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
        <SearchSelect
          className="max-w-xs"
          value={report}
          onChange={setReport}
          options={REPORTS.map((r) => ({ value: r.key, label: r.label }))}
        />
        <SearchSelect
          className="max-w-xs"
          value={jobId}
          onChange={setJobId}
          options={(jobs?.jobs ?? []).map((j) => ({ value: j.id, label: j.code, sublabel: j.description }))}
          placeholder="Select job…"
          allowClear
        />
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
