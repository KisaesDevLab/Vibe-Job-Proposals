import { useEffect, useMemo, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Paperclip, Download, Inbox as InboxIcon, Trash2, Upload, Eye, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from '@darrow/shared';
import { PageHeader } from '@/components/Layout';
import { Modal, Skeleton, Empty, Badge, Spinner, toast } from '@/components/ui';
import { SearchSelect } from '@/components/SearchSelect';
import { SortableHeader, nextSort, compareValues, type SortState } from '@/components/SortableHeader';

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

type ExpSort = 'workDate' | 'vendor' | 'category' | 'amount' | 'attachment_count' | 'invoiceId';
interface ExpFilters { workDate: string; vendor: string; category: '' | ExpenseCategory; amountMin: string; status: '' | 'billed' | 'unbilled'; }
const EXP_EMPTY: ExpFilters = { workDate: '', vendor: '', category: '', amountMin: '', status: '' };

function ExpenseList() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['expenses'], queryFn: () => api.get<{ expenses: Expense[] }>('/expenses?pageSize=500') });
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Expense | null>(null);
  const [sort, setSort] = useState<SortState<ExpSort>>({ key: 'workDate', dir: 'desc' });
  const [filters, setFilters] = useState<ExpFilters>(EXP_EMPTY);
  const filterActive = Object.values(filters).some(Boolean);

  const filtered = useMemo(() => {
    const rows = data?.expenses ?? [];
    const minAmt = Number(filters.amountMin || 0);
    const matches = rows.filter((x) =>
      (!filters.workDate || x.workDate.includes(filters.workDate)) &&
      (!filters.vendor || x.vendor.toLowerCase().includes(filters.vendor.toLowerCase())) &&
      (!filters.category || x.category === filters.category) &&
      (!filters.amountMin || Number(x.amount) >= minAmt) &&
      (!filters.status || (filters.status === 'billed' ? !!x.invoiceId : !x.invoiceId)),
    );
    return [...matches].sort((a, b) => {
      const numeric: ExpSort[] = ['amount', 'attachment_count'];
      const av = sort.key === 'invoiceId' ? (a.invoiceId ? 'billed' : 'unbilled') : numeric.includes(sort.key) ? Number((a as any)[sort.key] ?? 0) : (a as any)[sort.key];
      const bv = sort.key === 'invoiceId' ? (b.invoiceId ? 'billed' : 'unbilled') : numeric.includes(sort.key) ? Number((b as any)[sort.key] ?? 0) : (b as any)[sort.key];
      return compareValues(av, bv, sort.dir);
    });
  }, [data, filters, sort]);

  return (
    <div>
      <div className="mb-3 flex justify-end"><button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New Expense</button></div>
      {isLoading ? <Skeleton /> : !data?.expenses.length ? <Empty title="No expenses yet" /> : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs text-muted">
            <span>{filtered.length} of {data.expenses.length} expense{data.expenses.length === 1 ? '' : 's'}</span>
            {filterActive && <button className="text-copper hover:underline" onClick={() => setFilters(EXP_EMPTY)}>Clear filters</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <SortableHeader<ExpSort> label="Date" sortKey="workDate" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                  <SortableHeader<ExpSort> label="Vendor" sortKey="vendor" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                  <SortableHeader<ExpSort> label="Category" sortKey="category" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                  <SortableHeader<ExpSort> label="Amount" sortKey="amount" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} align="right" />
                  <SortableHeader<ExpSort> label="Files" sortKey="attachment_count" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} align="right" />
                  <SortableHeader<ExpSort> label="Status" sortKey="invoiceId" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                </tr>
                <tr className="bg-paper/50">
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" placeholder="YYYY-MM" value={filters.workDate} onChange={(e) => setFilters({ ...filters, workDate: e.target.value })} /></th>
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" placeholder="filter…" value={filters.vendor} onChange={(e) => setFilters({ ...filters, vendor: e.target.value })} /></th>
                  <th className="px-3 py-1.5">
                    <SearchSelect value={filters.category} onChange={(v) => setFilters({ ...filters, category: v as any })} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] }))} placeholder="all" allowClear />
                  </th>
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" inputMode="decimal" placeholder="≥" value={filters.amountMin} onChange={(e) => setFilters({ ...filters, amountMin: e.target.value.replace(/[^0-9.]/g, '') })} /></th>
                  <th className="px-3 py-1.5"></th>
                  <th className="px-3 py-1.5">
                    <SearchSelect value={filters.status} onChange={(v) => setFilters({ ...filters, status: v as any })} options={[{ value: 'unbilled', label: 'unbilled' }, { value: 'billed', label: 'billed' }]} placeholder="all" allowClear />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="td text-center text-muted">No expenses match the current filters</td></tr>
                ) : filtered.map((x) => (
                  <tr key={x.id} className="cursor-pointer hover:bg-paper" onClick={() => setDetail(x)}>
                    <td className="td">{x.workDate}</td>
                    <td className="td font-medium">{x.vendor}</td>
                    <td className="td">{EXPENSE_CATEGORY_LABELS[x.category as keyof typeof EXPENSE_CATEGORY_LABELS]}</td>
                    <td className="td text-right">{formatMoney(x.amount)}</td>
                    <td className="td text-right">{x.attachment_count > 0 && <span className="inline-flex items-center gap-1 text-muted"><Paperclip size={13} />{x.attachment_count}</span>}</td>
                    <td className="td">{x.invoiceId ? <Badge status="finalized">billed</Badge> : <Badge>unbilled</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        <div><label className="label">Job</label>
          <SearchSelect
            value={f.job_id}
            onChange={(v) => setF({ ...f, job_id: v })}
            options={(jobs?.jobs ?? []).map((j: any) => ({ value: j.id, label: j.code, sublabel: j.description }))}
            placeholder="Select…"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Vendor</label><input className="input" value={f.vendor} onChange={set('vendor')} /></div>
          <div><label className="label">Category</label>
            <SearchSelect
              value={f.category}
              onChange={(v) => setF({ ...f, category: v })}
              options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] }))}
            />
          </div>
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
  const { data: jobs } = useQuery({ queryKey: ['jobs-active'], queryFn: () => api.get<{ jobs: any[] }>('/jobs?active=true&pageSize=300') });
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null);
  const [f, setF] = useState<{ work_date: string; job_id: string; vendor: string; amount: string; category: string; reference: string; description: string } | null>(null);
  // Initialize the editable form once the detail loads (or after a save refetch
  // overwrites the row with server-canonical values).
  const rowKey = data ? `${data.updatedAt ?? ''}|${data.id}` : '';
  const [seededFrom, setSeededFrom] = useState('');
  // Re-seed when the row identity/version changes. In-render setState was the
  // old pattern; React 18 strict mode warns on it.
  useEffect(() => {
    if (data && rowKey !== seededFrom) {
      setF({
        work_date: data.workDate ?? data.work_date ?? '',
        job_id: data.jobId ?? data.job_id ?? '',
        vendor: data.vendor ?? '',
        amount: String(data.amount ?? ''),
        category: data.category ?? 'materials',
        reference: data.reference ?? '',
        description: data.description ?? '',
      });
      setSeededFrom(rowKey);
    }
  }, [data, rowKey, seededFrom]);
  const locked = !!(data?.invoiceId ?? data?.invoice_id);

  const save = useMutation({
    mutationFn: () => api.put(`/expenses/${expense.id}`, {
      work_date: f!.work_date,
      job_id: f!.job_id,
      vendor: f!.vendor,
      amount: Number(f!.amount),
      category: f!.category,
      reference: f!.reference || null,
      description: f!.description || null,
    }),
    onSuccess: () => {
      toast('Expense updated');
      qc.invalidateQueries({ queryKey: ['expense', expense.id] });
      onChanged();
    },
    onError: (e: any) => toast(e.message, 'err'),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/expenses/${expense.id}`),
    onSuccess: () => { toast('Expense deleted'); onChanged(); onClose(); },
    onError: (e: any) => toast(e.message, 'err'),
  });

  async function upload(file: File) {
    setUploading(true);
    try { await api.upload(`/expenses/${expense.id}/attachments`, file); toast('Uploaded'); qc.invalidateQueries({ queryKey: ['expense', expense.id] }); onChanged(); }
    catch (e: any) { toast(e.message, 'err'); }
    finally { setUploading(false); }
  }

  async function deleteAttachment(id: string, name: string) {
    if (!window.confirm(`Delete attachment "${name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/expenses/attachments/${id}`);
      toast('Attachment deleted');
      if (preview?.id === id) setPreview(null);
      qc.invalidateQueries({ queryKey: ['expense', expense.id] });
      onChanged();
    } catch (e: any) { toast(e.message, 'err'); }
  }

  async function retryAttachment(id: string) {
    try {
      await api.post(`/expenses/attachments/${id}/retry`);
      toast('Conversion re-queued');
      qc.invalidateQueries({ queryKey: ['expense', expense.id] });
    } catch (e: any) { toast(e.message, 'err'); }
  }

  const set = (k: keyof NonNullable<typeof f>) => (e: any) => f && setF({ ...f, [k]: e.target.value });
  const title = data ? `${data.vendor} — ${formatMoney(data.amount)}` : `${expense.vendor} — ${formatMoney(expense.amount)}`;
  const dirty = !!f && !!data && (
    f.work_date !== (data.workDate ?? '') ||
    f.job_id !== (data.jobId ?? '') ||
    f.vendor !== (data.vendor ?? '') ||
    Number(f.amount) !== Number(data.amount) ||
    f.category !== (data.category ?? '') ||
    (f.reference || '') !== (data.reference ?? '') ||
    (f.description || '') !== (data.description ?? '')
  );

  return (
    <Modal open onClose={onClose} title={title} wide>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="space-y-3">
          {locked && (
            <div className="rounded-lg bg-paper px-3 py-2 text-xs text-muted">
              This expense is billed on an invoice and locked. Void the invoice first to edit.
            </div>
          )}
          {!f ? <Skeleton rows={4} /> : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">Date</label><input type="date" className="input" value={f.work_date} onChange={set('work_date')} disabled={locked} /></div>
                <div><label className="label">Amount</label><input className="input" value={f.amount} onChange={set('amount')} disabled={locked} /></div>
              </div>
              <div><label className="label">Job</label>
                <SearchSelect
                  value={f.job_id}
                  onChange={(v) => setF({ ...f, job_id: v })}
                  options={(jobs?.jobs ?? []).map((j: any) => ({ value: j.id, label: j.code, sublabel: j.description }))}
                  placeholder="Select…"
                  disabled={locked}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">Vendor</label><input className="input" value={f.vendor} onChange={set('vendor')} disabled={locked} /></div>
                <div><label className="label">Category</label>
                  <SearchSelect
                    value={f.category}
                    onChange={(v) => setF({ ...f, category: v })}
                    options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] }))}
                    disabled={locked}
                  />
                </div>
              </div>
              <div><label className="label">Reference</label><input className="input" value={f.reference} onChange={set('reference')} placeholder="vendor invoice #" disabled={locked} /></div>
              <div><label className="label">Description</label><input className="input" value={f.description} onChange={set('description')} disabled={locked} /></div>
              <div className="flex items-center justify-between pt-1">
                <button className="btn-ghost text-red" onClick={() => del.mutate()} disabled={locked || del.isPending}>
                  <Trash2 size={15} /> Delete
                </button>
                <div className="flex gap-2">
                  <button className="btn-ghost" onClick={onClose}>Close</button>
                  <button
                    className="btn-primary"
                    onClick={() => save.mutate()}
                    disabled={locked || !dirty || !f.vendor || !f.job_id || !(Number(f.amount) > 0) || save.isPending}
                  >
                    {save.isPending ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">Attachments</div>
          <div className="rounded-lg border border-dashed border-line p-4 text-center">
            <input type="file" id="att" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} accept=".pdf,.png,.jpg,.jpeg,.webp,.heic" />
            <label htmlFor="att" className="btn-ghost cursor-pointer">{uploading ? 'Uploading…' : 'Add attachment (PDF/image)'}</label>
          </div>
          <div className="space-y-2">
            {data?.attachments?.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-line p-2 text-sm">
                {a.status === 'ready' ? (
                  <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={() => setPreview({ id: a.id, name: a.originalFilename })} title="Click to preview">
                    <img src={`/api/expenses/attachments/${a.id}/preview`} alt="" className="h-10 w-8 shrink-0 rounded border border-line object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                    <span className="truncate hover:underline">{a.originalFilename}</span>
                  </button>
                ) : (
                  <span className="flex min-w-0 items-center gap-2">
                    <Paperclip size={14} className="shrink-0" />
                    <span className="truncate">{a.originalFilename}</span>
                  </span>
                )}
                <span className="flex shrink-0 items-center gap-2">
                  <Badge status={a.status}>{a.status}</Badge>
                  {a.status === 'ready' && (
                    <>
                      <button className="text-muted hover:text-copper" onClick={() => setPreview({ id: a.id, name: a.originalFilename })} title="Preview"><Eye size={15} /></button>
                      <a className="text-muted hover:text-copper" href={`/api/expenses/attachments/${a.id}/download`} target="_blank" rel="noreferrer" title="Download"><Download size={15} /></a>
                    </>
                  )}
                  {a.status === 'failed' && (
                    <button className="text-muted hover:text-copper" onClick={() => retryAttachment(a.id)} title="Retry conversion"><RefreshCw size={15} /></button>
                  )}
                  <button className="text-muted hover:text-red disabled:opacity-40" onClick={() => deleteAttachment(a.id, a.originalFilename)} disabled={locked} title={locked ? 'Locked — void the invoice first' : 'Delete attachment'}><Trash2 size={15} /></button>
                </span>
              </div>
            ))}
            {!data?.attachments?.length && <div className="text-center text-sm text-muted">No attachments</div>}
          </div>
        </div>
      </div>
      {preview && (
        <Modal open onClose={() => setPreview(null)} title={preview.name} wide>
          <iframe title="attachment preview" src={`/api/expenses/attachments/${preview.id}/download`} className="h-[75vh] w-full rounded-lg border border-line" />
          <div className="flex justify-end pt-3">
            <a className="btn-ghost" href={`/api/expenses/attachments/${preview.id}/download`} target="_blank" rel="noreferrer"><Download size={15} /> Download</a>
          </div>
        </Modal>
      )}
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
  const { data: link } = useQuery({
    queryKey: ['inbox-public-link'],
    queryFn: () => api.get<{ enabled: boolean; url: string | null }>('/inbox/public-link'),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['inbox'] });
  function copyLink() {
    if (!link?.url) return;
    navigator.clipboard.writeText(link.url).then(() => toast('Link copied')).catch(() => toast('Copy failed — select and copy manually', 'err'));
  }

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
      {/* Employee upload link — visible only when PUBLIC_UPLOAD_TOKEN is set
          on the server. Field workers paste/photograph their bills here
          without needing a login. */}
      {link && (
        <div className="mb-4 card p-4">
          <div className="mb-1 text-sm font-semibold">Employee upload link</div>
          {link.enabled && link.url ? (
            <>
              <p className="mb-2 text-xs text-muted">Share this URL with field workers to upload receipts directly. They don't need to log in. Treat the URL like a password — anyone with it can submit bills.</p>
              <div className="flex items-center gap-2">
                <input className="input flex-1 font-mono text-xs" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn-ghost" onClick={copyLink}>Copy</button>
                <a className="btn-ghost" href={link.url} target="_blank" rel="noreferrer">Open</a>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted">Public uploads are disabled. Set <span className="font-mono">PUBLIC_UPLOAD_TOKEN</span> in the app environment to enable a no-login link for employees.</p>
          )}
        </div>
      )}
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
                    <button className="btn-ghost" onClick={() => api.post(`/inbox/${selected.id}/retry`).then(invalidate).catch((e: any) => toast(e.message ?? String(e), 'err'))}>Retry</button>
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
  // Done in an effect so we don't setState during render (React 18 warns).
  const [matched, setMatched] = useState(false);
  useEffect(() => {
    if (jobs && doc.submitted_job_code && !f.job_id && !matched) {
      const hit = jobs.jobs.find((j) => j.code.toLowerCase() === doc.submitted_job_code!.trim().toLowerCase());
      setMatched(true);
      if (hit) setF((p) => ({ ...p, job_id: hit.id }));
    }
  }, [jobs, doc.submitted_job_code, f.job_id, matched]);
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
      <div><label className="label">Job</label>
        <SearchSelect
          value={f.job_id}
          onChange={(v) => setF({ ...f, job_id: v })}
          options={(jobs?.jobs ?? []).map((j: any) => ({ value: j.id, label: j.code, sublabel: j.description }))}
          placeholder="Select…"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Vendor</label><input className="input" value={f.vendor} onChange={set('vendor')} /></div>
        <div><label className="label">Category</label>
          <SearchSelect
            value={f.category}
            onChange={(v) => setF({ ...f, category: v })}
            options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] }))}
          />
        </div>
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
