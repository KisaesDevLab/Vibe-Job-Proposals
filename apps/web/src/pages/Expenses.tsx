import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Paperclip, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '@darrow/shared';
import { PageHeader } from '@/components/Layout';
import { Modal, Skeleton, Empty, Badge, toast } from '@/components/ui';

interface Expense { id: string; workDate: string; vendor: string; amount: string; category: string; invoiceId: string | null; attachment_count: number; }

export function ExpensesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['expenses'], queryFn: () => api.get<{ expenses: Expense[] }>('/expenses?pageSize=100') });
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Expense | null>(null);
  return (
    <div>
      <PageHeader title="Expenses" subtitle="Job-related costs with receipt attachments"
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New Expense</button>} />
      {isLoading ? <Skeleton /> : !data?.expenses.length ? <Empty title="No expenses yet" /> : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr><th className="th">Date</th><th className="th">Vendor</th><th className="th">Category</th><th className="th">Amount</th><th className="th">Files</th><th className="th">Status</th></tr></thead>
            <tbody>
              {data.expenses.map((x) => (
                <tr key={x.id} className="cursor-pointer hover:bg-paper" onClick={() => setDetail(x)}>
                  <td className="td">{x.workDate}</td>
                  <td className="td font-medium">{x.vendor}</td>
                  <td className="td">{EXPENSE_CATEGORY_LABELS[x.category as keyof typeof EXPENSE_CATEGORY_LABELS]}</td>
                  <td className="td">{formatMoney(x.amount)}</td>
                  <td className="td">{x.attachment_count > 0 && <span className="inline-flex items-center gap-1 text-muted"><Paperclip size={13} />{x.attachment_count}</span>}</td>
                  <td className="td">{x.invoiceId ? <Badge status="finalized">billed</Badge> : <Badge>unbilled</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <ExpenseForm onClose={() => setCreating(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['expenses'] }); setCreating(false); }} />}
      {detail && <ExpenseDetail expense={detail} onClose={() => setDetail(null)} onChanged={() => qc.invalidateQueries({ queryKey: ['expenses'] })} />}
    </div>
  );
}

function ExpenseForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: jobs } = useQuery({ queryKey: ['jobs'], queryFn: () => api.get<{ jobs: any[] }>('/jobs?active=true&pageSize=200') });
  const [f, setF] = useState({ work_date: new Date().toISOString().slice(0, 10), job_id: '', vendor: '', amount: '', category: 'materials', description: '' });
  const m = useMutation({ mutationFn: () => api.post('/expenses', { ...f, amount: Number(f.amount) }), onSuccess: () => { toast('Expense created'); onSaved(); }, onError: (e: any) => toast(e.message, 'err') });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title="New Expense">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Date</label><input type="date" className="input" value={f.work_date} onChange={set('work_date')} /></div>
          <div><label className="label">Amount</label><input className="input" value={f.amount} onChange={set('amount')} /></div>
        </div>
        <div><label className="label">Job</label><select className="input" value={f.job_id} onChange={set('job_id')}><option value="">Select…</option>{jobs?.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.description}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Vendor</label><input className="input" value={f.vendor} onChange={set('vendor')} /></div>
          <div><label className="label">Category</label><select className="input" value={f.category} onChange={set('category')}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>)}</select></div>
        </div>
        <div><label className="label">Description</label><input className="input" value={f.description} onChange={set('description')} /></div>
        <div className="flex justify-end gap-2 pt-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => m.mutate()} disabled={!f.job_id || !f.vendor || !f.amount || m.isPending}>Save</button></div>
      </div>
    </Modal>
  );
}

function ExpenseDetail({ expense, onClose, onChanged }: { expense: Expense; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['expense', expense.id], queryFn: () => api.get<any>(`/expenses/${expense.id}`), refetchInterval: (q) => (q.state.data?.attachments?.some((a: any) => a.status === 'pending') ? 2000 : false) });
  const [uploading, setUploading] = useState(false);
  async function upload(file: File) {
    setUploading(true);
    try { await api.upload(`/expenses/${expense.id}/attachments`, file); toast('Uploaded'); qc.invalidateQueries({ queryKey: ['expense', expense.id] }); onChanged(); }
    catch (e: any) { toast(e.message, 'err'); }
    finally { setUploading(false); }
  }
  return (
    <Modal open onClose={onClose} title={`${expense.vendor} — ${formatMoney(expense.amount)}`}>
      <div className="space-y-3">
        <div className="rounded-lg border border-dashed border-line p-4 text-center">
          <input type="file" id="att" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} accept=".pdf,.png,.jpg,.jpeg,.webp,.heic" />
          <label htmlFor="att" className="btn-ghost cursor-pointer">{uploading ? 'Uploading…' : 'Add attachment (PDF/image)'}</label>
        </div>
        <div className="space-y-2">
          {data?.attachments?.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border border-line p-2 text-sm">
              <span className="flex items-center gap-2">
                {a.status === 'ready' ? (
                  <img src={`/api/expenses/attachments/${a.id}/preview`} alt="" className="h-10 w-8 rounded border border-line object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                ) : (
                  <Paperclip size={14} />
                )}
                {a.originalFilename}
              </span>
              <span className="flex items-center gap-2">
                <Badge status={a.status}>{a.status}</Badge>
                {a.status === 'ready' && <a className="text-copper" href={`/api/expenses/attachments/${a.id}/download`} target="_blank" rel="noreferrer"><Download size={15} /></a>}
              </span>
            </div>
          ))}
          {!data?.attachments?.length && <div className="text-center text-sm text-muted">No attachments</div>}
        </div>
      </div>
    </Modal>
  );
}
