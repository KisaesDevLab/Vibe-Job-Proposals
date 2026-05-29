import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { Skeleton } from '@/components/ui';

export function ReadinessPage() {
  const { data, isLoading } = useQuery({ queryKey: ['readiness'], queryFn: () => api.get<any>('/reports/readiness') });
  if (isLoading) return <div><PageHeader title="Readiness" /><Skeleton /></div>;
  const cards = [
    { key: 'jobs_without_schedule', label: 'Jobs without a covering rate schedule', render: (i: any) => `${i.code} — ${i.customer}` },
    { key: 'employees_without_cost', label: 'Active employees with no current cost rate', render: (i: any) => i.name },
    { key: 'failed_attachments', label: 'Expenses with a failed attachment conversion', render: (i: any) => i.original_filename },
    { key: 'stale_drafts', label: 'Draft invoices older than 30 days', render: (i: any) => i.job_code },
  ];
  return (
    <div>
      <PageHeader title="Readiness" subtitle="Check before issuing new invoices" />
      <div className="grid grid-cols-2 gap-4">
        {cards.map((c) => {
          const blk = data[c.key];
          const ok = blk.count === 0;
          return (
            <div key={c.key} className="card p-4">
              <div className="mb-2 flex items-center gap-2">
                {ok ? <CheckCircle className="text-green" size={18} /> : <AlertTriangle className="text-amber" size={18} />}
                <span className="font-semibold">{blk.count}</span>
                <span className="text-sm text-muted">{c.label}</span>
              </div>
              {!ok && <ul className="ml-7 list-disc text-sm text-muted">{blk.items.slice(0, 8).map((i: any, idx: number) => <li key={idx}>{c.render(i)}</li>)}</ul>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
