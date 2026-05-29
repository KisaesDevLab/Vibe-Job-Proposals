import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { Modal, Skeleton, Empty, Badge, toast } from '@/components/ui';

interface Job { id: string; code: string; customerName: string; description: string; billingType: string; active: boolean; invoiceCount: number; }
interface Customer { id: string; name: string; active: boolean; }

export function JobsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['jobs', search], queryFn: () => api.get<{ jobs: Job[] }>(`/jobs?search=${encodeURIComponent(search)}&pageSize=100`) });
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader title="Jobs" subtitle="Work orders by customer"
        actions={<>
          <a className="btn-ghost" href="/api/jobs/export/csv">Export CSV</a>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New Job</button>
        </>} />
      <input className="input mb-4 max-w-sm" placeholder="Search code or description…" value={search} onChange={(e) => setSearch(e.target.value)} />
      {isLoading ? <Skeleton /> : !data?.jobs.length ? <Empty title="No jobs found" /> : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr><th className="th">Code</th><th className="th">Customer</th><th className="th">Description</th><th className="th">Type</th><th className="th">Invoices</th><th className="th">Status</th></tr></thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.id}>
                  <td className="td font-mono font-medium">{j.code}</td>
                  <td className="td">{j.customerName}</td>
                  <td className="td">{j.description}</td>
                  <td className="td"><Badge status={j.billingType}>{j.billingType === 'tm' ? 'T&M' : 'Quote'}</Badge></td>
                  <td className="td">{j.invoiceCount}</td>
                  <td className="td">{j.active ? <Badge status="finalized">active</Badge> : <Badge status="void">inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <JobForm onClose={() => setCreating(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['jobs'] }); setCreating(false); }} />}
    </div>
  );
}

function JobForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: () => api.get<Customer[]>('/customers') });
  const [f, setF] = useState({ code: '', customer_id: '', description: '', po_number: '', billing_type: 'tm' });
  const m = useMutation({ mutationFn: () => api.post('/jobs', f), onSuccess: () => { toast('Job created'); onSaved(); }, onError: (e: any) => toast(e.message, 'err') });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title="New Job">
      <div className="space-y-3">
        <div><label className="label">Code <span className="text-muted">(e.g., D26NB048)</span></label><input className="input font-mono" value={f.code} onChange={set('code')} /></div>
        <div><label className="label">Customer</label><select className="input" value={f.customer_id} onChange={set('customer_id')}><option value="">Select…</option>{customers?.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label">Description</label><input className="input" value={f.description} onChange={set('description')} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">PO number</label><input className="input" value={f.po_number} onChange={set('po_number')} /></div>
          <div><label className="label">Billing type</label><select className="input" value={f.billing_type} onChange={set('billing_type')}><option value="tm">Time &amp; Materials</option><option value="quote">Quote</option></select></div>
        </div>
        <div className="flex justify-end gap-2 pt-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => m.mutate()} disabled={!f.code || !f.customer_id || !f.description || m.isPending}>Save</button></div>
      </div>
    </Modal>
  );
}
