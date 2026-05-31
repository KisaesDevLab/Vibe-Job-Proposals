import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Download, FileText, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@darrow/shared';
import { PageHeader } from '@/components/Layout';
import { Modal, Skeleton, Empty, Badge, toast } from '@/components/ui';

interface Invoice { id: string; billed_reference: string | null; status: string; job_code: string; customer_name: string; grand_total: string | null; through_date: string; imported_from_xlsm: boolean; }

export function InvoicesPage() {
  const [tab, setTab] = useState<'register' | 'billable'>('register');
  return (
    <div>
      <PageHeader title="Invoices" subtitle="Invoice register & billable totals by date range" />
      <div className="mb-5 flex gap-2 border-b border-line">
        <button onClick={() => setTab('register')} className={`px-3 py-2 text-sm font-medium ${tab === 'register' ? 'border-b-2 border-copper text-copper' : 'text-muted'}`}>Register</button>
        <button onClick={() => setTab('billable')} className={`px-3 py-2 text-sm font-medium ${tab === 'billable' ? 'border-b-2 border-copper text-copper' : 'text-muted'}`}>Billable by date range</button>
      </div>
      {tab === 'register' ? <InvoiceRegister /> : <BillableByRange />}
    </div>
  );
}

function InvoiceRegister() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [includeVoid, setIncludeVoid] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['invoices', includeVoid], queryFn: () => api.get<Invoice[]>(`/invoices?includeVoid=${includeVoid}`) });
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={includeVoid} onChange={(e) => setIncludeVoid(e.target.checked)} /> show voided</label>
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New Draft</button>
      </div>
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

interface JobTotal {
  job_id: string; code: string; customer_name: string; billing_type: string;
  st_hours: string; ot_hours: string; dt_hours: string; total_hours: string;
  labor_amount: string; expense_amount: string; total_amount: string;
  missing_rate: boolean; unbilled_count: string; open_draft_id: string | null;
}

function monthStart(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
}

// Each job's labor + expense totals within a date range, with a one-click path
// into invoicing (the draft bills all unbilled time/expenses through the to-date).
function BillableByRange() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [customerId, setCustomerId] = useState('');
  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: () => api.get<any[]>('/customers') });
  const { data, isFetching } = useQuery({
    queryKey: ['job-totals', from, to, customerId],
    queryFn: () => api.get<JobTotal[]>(`/reports/job-totals?from=${from}&to=${to}${customerId ? `&customer_id=${customerId}` : ''}`),
    enabled: !!from && !!to,
  });

  const create = useMutation({
    mutationFn: (job_id: string) => api.post<{ id: string }>('/invoices/draft', { job_id, through_date: to }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['job-totals'] }); nav({ to: '/invoices/$id', params: { id: r.id } }); },
    onError: (e: any) => {
      if (e.code === 'draft_exists' && e.details?.invoice_id) nav({ to: '/invoices/$id', params: { id: e.details.invoice_id } });
      else if (e.code === 'future_date') toast('The "to" date is in the future — set it to today or earlier to bill.', 'err');
      else toast(e.message, 'err');
    },
  });

  const totals = (data ?? []).reduce(
    (a, r) => ({ labor: a.labor + Number(r.labor_amount), exp: a.exp + Number(r.expense_amount), total: a.total + Number(r.total_amount), hours: a.hours + Number(r.total_hours) }),
    { labor: 0, exp: 0, total: 0, hours: 0 },
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div><label className="label">Customer</label>
          <select className="input max-w-xs" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">All customers</option>
            {customers?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <a className="btn-ghost" href={`/api/reports/job-totals?from=${from}&to=${to}${customerId ? `&customer_id=${customerId}` : ''}&format=csv`}><Download size={15} /> CSV</a>
      </div>

      {isFetching ? <Skeleton rows={5} /> : !data?.length ? <Empty title="No job activity in this range" hint="Adjust the dates or customer" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Job</th><th className="th">Customer</th><th className="th">Type</th>
                <th className="th text-right">Hours</th><th className="th text-right">Labor</th>
                <th className="th text-right">Expenses</th><th className="th text-right">Total</th>
                <th className="th">Status</th><th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.job_id} className="hover:bg-paper">
                  <td className="td font-mono font-medium">{r.code}</td>
                  <td className="td">{r.customer_name}</td>
                  <td className="td"><Badge status={r.billing_type}>{r.billing_type === 'tm' ? 'T&M' : 'Quote'}</Badge></td>
                  <td className="td text-right" title={`ST ${r.st_hours} · OT ${r.ot_hours} · DT ${r.dt_hours}`}>{Number(r.total_hours)}</td>
                  <td className="td text-right">{formatMoney(r.labor_amount)}{r.missing_rate && <span title="Some hours have no rate schedule — labor is understated"><AlertTriangle className="ml-1 inline text-amber" size={13} /></span>}</td>
                  <td className="td text-right">{formatMoney(r.expense_amount)}</td>
                  <td className="td text-right font-semibold">{formatMoney(r.total_amount)}</td>
                  <td className="td">{Number(r.unbilled_count) > 0 ? <Badge status="pending">{r.unbilled_count} unbilled</Badge> : <Badge status="finalized">billed</Badge>}</td>
                  <td className="td text-right">
                    {r.open_draft_id ? (
                      <button className="btn-ghost" onClick={() => nav({ to: '/invoices/$id', params: { id: r.open_draft_id! } })}><FileText size={14} /> Open draft</button>
                    ) : (
                      <button className="btn-primary" disabled={Number(r.unbilled_count) === 0 || create.isPending} onClick={() => create.mutate(r.job_id)}>Create invoice →</button>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-line font-semibold">
                <td className="td" colSpan={3}>Totals ({data.length} jobs)</td>
                <td className="td text-right">{totals.hours}</td>
                <td className="td text-right">{formatMoney(totals.labor)}</td>
                <td className="td text-right">{formatMoney(totals.exp)}</td>
                <td className="td text-right">{formatMoney(totals.total)}</td>
                <td className="td" colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        Totals cover all time &amp; expenses dated in the range. <b>Create invoice</b> starts a draft that bills every
        unbilled entry for that job dated on or before the <b>To</b> date (you can fine-tune the selection on the draft screen).
      </p>
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
