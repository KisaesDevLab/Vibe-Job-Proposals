import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@darrow/shared';
import { PageHeader } from '@/components/Layout';
import { Modal, Skeleton, Empty, Badge, toast } from '@/components/ui';

interface Invoice { id: string; billed_reference: string | null; status: string; job_code: string; customer_name: string; grand_total: string | null; through_date: string; imported_from_xlsm: boolean; }

export function InvoicesPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [includeVoid, setIncludeVoid] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['invoices', includeVoid], queryFn: () => api.get<Invoice[]>(`/invoices?includeVoid=${includeVoid}`) });
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader title="Invoices" subtitle="Invoice register"
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New Draft</button>} />
      <label className="mb-3 flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={includeVoid} onChange={(e) => setIncludeVoid(e.target.checked)} /> show voided</label>
      {isLoading ? <Skeleton /> : !data?.length ? <Empty title="No invoices yet" hint="Create a draft to bill a job" /> : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr><th className="th">Invoice #</th><th className="th">Job</th><th className="th">Customer</th><th className="th">Through</th><th className="th">Total</th><th className="th">Status</th></tr></thead>
            <tbody>
              {data.map((inv) => (
                <tr key={inv.id} className="cursor-pointer hover:bg-paper" onClick={() => nav({ to: '/invoices/$id', params: { id: inv.id } })}>
                  <td className="td font-mono font-medium">{inv.billed_reference ?? <span className="text-muted">draft</span>}{inv.imported_from_xlsm && <Badge>Historical</Badge>}</td>
                  <td className="td font-mono">{inv.job_code}</td>
                  <td className="td">{inv.customer_name}</td>
                  <td className="td">{inv.through_date}</td>
                  <td className="td">{inv.grand_total ? formatMoney(inv.grand_total) : '—'}</td>
                  <td className="td"><Badge status={inv.status}>{inv.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewDraft onClose={() => setCreating(false)} onCreated={(id) => { qc.invalidateQueries({ queryKey: ['invoices'] }); nav({ to: '/invoices/$id', params: { id } }); }} />}
    </div>
  );
}

function NewDraft({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { data: jobs } = useQuery({ queryKey: ['jobs'], queryFn: () => api.get<{ jobs: any[] }>('/jobs?active=true&pageSize=200') });
  const [job_id, setJob] = useState('');
  const [through_date, setThrough] = useState(new Date().toISOString().slice(0, 10));
  const m = useMutation({ mutationFn: () => api.post<{ id: string }>('/invoices/draft', { job_id, through_date }), onSuccess: (r) => onCreated(r.id), onError: (e: any) => toast(e.message, 'err') });
  return (
    <Modal open onClose={onClose} title="New Invoice Draft">
      <div className="space-y-3">
        <div><label className="label">Job</label><select className="input" value={job_id} onChange={(e) => setJob(e.target.value)}><option value="">Select…</option>{jobs?.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.description}</option>)}</select></div>
        <div><label className="label">Through date</label><input type="date" className="input" value={through_date} onChange={(e) => setThrough(e.target.value)} /></div>
        <p className="text-xs text-muted">All unbilled time &amp; expenses on/before this date will be auto-selected.</p>
        <div className="flex justify-end gap-2 pt-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => m.mutate()} disabled={!job_id || m.isPending}>Create draft</button></div>
      </div>
    </Modal>
  );
}
