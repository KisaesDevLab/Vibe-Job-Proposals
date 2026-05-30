import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Paperclip, Download, Inbox as InboxIcon, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '@darrow/shared';
import { PageHeader } from '@/components/Layout';
import { Modal, Skeleton, Empty, Badge, Spinner, toast } from '@/components/ui';

interface Expense { id: string; workDate: string; vendor: string; amount: string; category: string; invoiceId: string | null; attachment_count: number; }

export function ExpensesPage() {
  const [tab, setTab] = useState<'expenses' | 'inbox'>('expenses');
  const { data: inbox } = useQuery({ queryKey: ['inbox'], queryFn: () => api.get<any[]>('/inbox'), refetchInterval: (q) => (q.state.data?.some((d: any) => d.status === 'pending') ? 2000 : false) });
  return (
    <div>
      <PageHeader title="Expenses" subtitle="Job-related costs, receipts & the bill processing inbox" />
      <div className="mb-5 flex gap-2 border-b border-line">
        <button onClick={() => setTab('expenses')} className={`px-3 py-2 text-sm font-medium ${tab === 'expenses' ? 'border-b-2 border-copper text-copper' : 'text-muted'}`}>Expenses</button>
        <button onClick={() => setTab('inbox')} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${tab === 'inbox' ? 'border-b-2 border-copper text-copper' : 'text-muted'}`}>
          <InboxIcon size={15} /> Inbox{inbox && inbox.length > 0 && <span className="rounded-full bg-copper px-1.5 text-xs text-white">{inbox.length}</span>}
        </button>
      </div>
      {tab === 'expenses' ? <ExpenseList /> : <InboxTab />}
    </div>
  );
}

function ExpenseList() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['expenses'], queryFn: () => api.get<{ expenses: Expense[] }>('/expenses?pageSize=100') });
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Expense | null>(null);
  return (
    <div>
      <div className="mb-3 flex justify-end"><button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New Expense</button></div>
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

interface InboxDoc { id: string; original_filename: string; status: string; file_size_bytes: number; created_at: string; submitted_job_code?: string | null; notes?: string | null; source?: string; }

function InboxTab() {
  const qc = useQueryClient();
  const { data: docs, isLoading } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.get<InboxDoc[]>('/inbox'),
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === 'pending') ? 2000 : false),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['inbox'] });

  async function upload(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploading(true);
    try {
      const res = await api.uploadMany<{ created: InboxDoc[]; rejected: { filename: string; reason: string }[] }>('/inbox', arr);
      if (res.rejected.length) toast(`${res.rejected.length} file(s) rejected: ${res.rejected[0].reason}`, 'err');
      if (res.created.length) toast(`Uploaded ${res.created.length} bill(s)`);
      invalidate();
    } catch (e: any) { toast(e.message, 'err'); }
    finally { setUploading(false); }
  }

  const selected = docs?.find((d) => d.id === selectedId) ?? null;
  function advance(removedId: string) {
    const remaining = (docs ?? []).filter((d) => d.id !== removedId);
    setSelectedId(remaining[0]?.id ?? null);
  }

  return (
    <div>
      <div
        className="mb-4 flex items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line bg-card p-6 text-sm text-muted"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}
        onPaste={(e) => { if (e.clipboardData.files.length) upload(e.clipboardData.files); }}
        tabIndex={0}
      >
        <Upload size={18} />
        <span>Drag bills here, paste from clipboard, or</span>
        <button className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? 'Uploading…' : 'choose files'}</button>
        <input ref={fileRef} type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic" onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>

      {isLoading ? <Skeleton rows={4} /> : !docs?.length ? <Empty title="The inbox is empty" hint="Upload bills above, then enter their details" /> : (
        <div className="grid grid-cols-[260px_1fr] gap-4">
          <div className="space-y-2">
            {docs.map((d) => (
              <button key={d.id} onClick={() => setSelectedId(d.id)} className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left text-sm ${selectedId === d.id ? 'border-copper bg-copper-soft' : 'border-line bg-card hover:bg-paper'}`}>
                {d.status === 'ready' ? (
                  <img src={`/api/inbox/${d.id}/preview`} alt="" className="h-12 w-9 rounded border border-line object-cover" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                ) : d.status === 'pending' ? <div className="grid h-12 w-9 place-items-center"><Spinner /></div> : <div className="grid h-12 w-9 place-items-center text-red"><Paperclip size={16} /></div>}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.original_filename}</div>
                  <div className="flex items-center gap-1">
                    <Badge status={d.status}>{d.status}</Badge>
                    {d.source === 'public' && <span className="badge bg-blue-soft text-blue">employee</span>}
                  </div>
                  {d.submitted_job_code && <div className="truncate font-mono text-xs text-muted">{d.submitted_job_code}</div>}
                </div>
              </button>
            ))}
          </div>

          {!selected ? <div className="card grid place-items-center text-muted">Select a bill to enter its details</div> : (
            <div className="grid grid-cols-2 gap-4">
              <InboxEntryForm key={selected.id} doc={selected} onProcessed={() => { invalidate(); advance(selected.id); qc.invalidateQueries({ queryKey: ['expenses'] }); }} onDeleted={() => { invalidate(); advance(selected.id); }} />
              <div className="card overflow-hidden">
                {selected.status === 'ready' ? (
                  <iframe title="bill preview" src={`/api/inbox/${selected.id}/download`} className="h-[70vh] w-full" />
                ) : selected.status === 'pending' ? (
                  <div className="grid h-[70vh] place-items-center text-muted"><Spinner /><span className="ml-2">Converting…</span></div>
                ) : (
                  <div className="grid h-[70vh] place-items-center gap-2 text-center">
                    <span className="text-red">Conversion failed</span>
                    <button className="btn-ghost" onClick={() => api.post(`/inbox/${selected.id}/retry`).then(invalidate)}>Retry</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InboxEntryForm({ doc, onProcessed, onDeleted }: { doc: InboxDoc; onProcessed: () => void; onDeleted: () => void }) {
  const { data: jobs } = useQuery({ queryKey: ['jobs-active'], queryFn: () => api.get<{ jobs: any[] }>('/jobs?active=true&pageSize=300') });
  const guessVendor = doc.original_filename.replace(/\.[^.]+$/, '').slice(0, 60);
  const [f, setF] = useState({ work_date: new Date().toISOString().slice(0, 10), job_id: '', vendor: guessVendor, amount: '', category: 'materials', reference: '', description: doc.notes ?? '' });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  // Pre-select the job if the employee's submitted code matches an active job.
  const [matched, setMatched] = useState(false);
  if (jobs && doc.submitted_job_code && !f.job_id && !matched) {
    const hit = jobs.jobs.find((j) => j.code.toLowerCase() === doc.submitted_job_code!.trim().toLowerCase());
    setMatched(true);
    if (hit) setF((p) => ({ ...p, job_id: hit.id }));
  }
  const process = useMutation({
    mutationFn: () => api.post(`/inbox/${doc.id}/process`, { ...f, amount: Number(f.amount), reference: f.reference || undefined, description: f.description || undefined }),
    onSuccess: () => { toast('Saved as expense'); onProcessed(); },
    onError: (e: any) => toast(e.message, 'err'),
  });
  const del = useMutation({ mutationFn: () => api.del(`/inbox/${doc.id}`), onSuccess: () => { toast('Bill discarded'); onDeleted(); }, onError: (e: any) => toast(e.message, 'err') });
  const ready = doc.status === 'ready';
  return (
    <div className="card space-y-3 p-4">
      <div className="text-sm font-semibold">Expense details</div>
      {(doc.submitted_job_code || doc.notes) && (
        <div className="rounded-lg bg-blue-soft px-3 py-2 text-xs text-blue">
          Submitted by employee{doc.submitted_job_code ? <> · job <span className="font-mono font-semibold">{doc.submitted_job_code}</span></> : ''}
          {doc.notes ? <div className="mt-0.5">“{doc.notes}”</div> : null}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Date</label><input type="date" className="input" value={f.work_date} onChange={set('work_date')} /></div>
        <div><label className="label">Amount</label><input className="input" value={f.amount} onChange={set('amount')} /></div>
      </div>
      <div><label className="label">Job</label><select className="input" value={f.job_id} onChange={set('job_id')}><option value="">Select…</option>{jobs?.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.description}</option>)}</select></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Vendor</label><input className="input" value={f.vendor} onChange={set('vendor')} /></div>
        <div><label className="label">Category</label><select className="input" value={f.category} onChange={set('category')}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>)}</select></div>
      </div>
      <div><label className="label">Reference</label><input className="input" value={f.reference} onChange={set('reference')} placeholder="vendor invoice #" /></div>
      <div><label className="label">Description</label><input className="input" value={f.description} onChange={set('description')} /></div>
      {!ready && <p className="text-xs text-amber">This bill is still converting; you can save once it's ready.</p>}
      <div className="flex items-center justify-between pt-1">
        <button className="btn-ghost text-red" onClick={() => del.mutate()} disabled={del.isPending}><Trash2 size={15} /> Discard</button>
        <button className="btn-primary" onClick={() => process.mutate()} disabled={!ready || !f.job_id || !f.vendor || !f.amount || process.isPending}>Save expense →</button>
      </div>
    </div>
  );
}
