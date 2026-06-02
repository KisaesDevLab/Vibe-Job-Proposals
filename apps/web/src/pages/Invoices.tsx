import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Download, FileText, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@darrow/shared';
import { PageHeader } from '@/components/Layout';
import { Modal, Skeleton, Empty, Badge, toast } from '@/components/ui';
import { SearchSelect } from '@/components/SearchSelect';
import { SortableHeader, nextSort, compareValues, type SortState } from '@/components/SortableHeader';

interface Invoice { id: string; billed_reference: string | null; status: string; job_code: string; customer_name: string; grand_total: string | null; through_date: string; imported_from_xlsm: boolean; }

export function InvoicesPage() {
  const [tab, setTab] = useState<'register' | 'billable' | 'summaries'>('register');
  return (
    <div>
      <PageHeader title="Invoices" subtitle="Invoice register, billable totals & summary invoices" />
      <div className="mb-5 flex gap-2 border-b border-line">
        <button onClick={() => setTab('register')} className={`px-3 py-2 text-sm font-medium ${tab === 'register' ? 'border-b-2 border-copper text-copper' : 'text-muted'}`}>Register</button>
        <button onClick={() => setTab('billable')} className={`px-3 py-2 text-sm font-medium ${tab === 'billable' ? 'border-b-2 border-copper text-copper' : 'text-muted'}`}>Billable by date range</button>
        <button onClick={() => setTab('summaries')} className={`px-3 py-2 text-sm font-medium ${tab === 'summaries' ? 'border-b-2 border-copper text-copper' : 'text-muted'}`}>Summaries</button>
      </div>
      {tab === 'register' ? <InvoiceRegister /> : tab === 'billable' ? <BillableByRange /> : <SummariesPanel />}
    </div>
  );
}

type RegisterSortKey = 'billed_reference' | 'job_code' | 'customer_name' | 'through_date' | 'grand_total' | 'status';
interface RegisterFilters { billed_reference: string; job_code: string; customer_name: string; through_date: string; status: '' | 'draft' | 'finalized' | 'void'; }
const REGISTER_EMPTY_FILTERS: RegisterFilters = { billed_reference: '', job_code: '', customer_name: '', through_date: '', status: '' };

function InvoiceRegister() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [includeVoid, setIncludeVoid] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['invoices', includeVoid], queryFn: () => api.get<Invoice[]>(`/invoices?includeVoid=${includeVoid}`) });
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState<SortState<RegisterSortKey>>({ key: 'through_date', dir: 'desc' });
  const [filters, setFilters] = useState<RegisterFilters>(REGISTER_EMPTY_FILTERS);

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const matches = rows.filter((r) =>
      (!filters.billed_reference || (r.billed_reference ?? 'draft').toLowerCase().includes(filters.billed_reference.toLowerCase())) &&
      (!filters.job_code || r.job_code.toLowerCase().includes(filters.job_code.toLowerCase())) &&
      (!filters.customer_name || r.customer_name.toLowerCase().includes(filters.customer_name.toLowerCase())) &&
      (!filters.through_date || r.through_date.includes(filters.through_date)) &&
      (!filters.status || r.status === filters.status),
    );
    return [...matches].sort((a, b) => {
      const av = sort.key === 'grand_total' ? Number(a.grand_total ?? 0) : sort.key === 'billed_reference' ? (a.billed_reference ?? '') : (a as any)[sort.key];
      const bv = sort.key === 'grand_total' ? Number(b.grand_total ?? 0) : sort.key === 'billed_reference' ? (b.billed_reference ?? '') : (b as any)[sort.key];
      return compareValues(av, bv, sort.dir);
    });
  }, [data, filters, sort]);

  const filterActive = Object.values(filters).some(Boolean);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={includeVoid} onChange={(e) => setIncludeVoid(e.target.checked)} /> show voided</label>
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New Draft</button>
      </div>
      {isLoading ? <Skeleton /> : !data?.length ? <Empty title="No invoices yet" hint="Create a draft to bill a job" /> : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs text-muted">
            <span>{filtered.length} of {data.length} invoice{data.length === 1 ? '' : 's'}</span>
            {filterActive && <button className="text-copper hover:underline" onClick={() => setFilters(REGISTER_EMPTY_FILTERS)}>Clear filters</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <SortableHeader<RegisterSortKey> label="Invoice #" sortKey="billed_reference" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                  <SortableHeader<RegisterSortKey> label="Job" sortKey="job_code" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                  <SortableHeader<RegisterSortKey> label="Customer" sortKey="customer_name" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                  <SortableHeader<RegisterSortKey> label="Through" sortKey="through_date" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                  <SortableHeader<RegisterSortKey> label="Total" sortKey="grand_total" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} align="right" />
                  <SortableHeader<RegisterSortKey> label="Status" sortKey="status" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                </tr>
                <tr className="bg-paper/50">
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" placeholder="filter…" value={filters.billed_reference} onChange={(e) => setFilters({ ...filters, billed_reference: e.target.value })} /></th>
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" placeholder="filter…" value={filters.job_code} onChange={(e) => setFilters({ ...filters, job_code: e.target.value })} /></th>
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" placeholder="filter…" value={filters.customer_name} onChange={(e) => setFilters({ ...filters, customer_name: e.target.value })} /></th>
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" placeholder="YYYY-MM" value={filters.through_date} onChange={(e) => setFilters({ ...filters, through_date: e.target.value })} /></th>
                  <th className="px-3 py-1.5"></th>
                  <th className="px-3 py-1.5">
                    <SearchSelect
                      value={filters.status}
                      onChange={(v) => setFilters({ ...filters, status: v as RegisterFilters['status'] })}
                      options={[{ value: 'draft', label: 'draft' }, { value: 'finalized', label: 'finalized' }, { value: 'void', label: 'void' }]}
                      placeholder="all"
                      allowClear
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="td text-center text-muted">No invoices match the current filters</td></tr>
                ) : filtered.map((inv) => (
                  <tr key={inv.id} className="cursor-pointer hover:bg-paper" onClick={() => nav({ to: '/invoices/$id', params: { id: inv.id } })}>
                    <td className="td font-mono font-medium">{inv.billed_reference ?? <span className="text-muted">draft</span>}{inv.imported_from_xlsm && <Badge>Historical</Badge>}</td>
                    <td className="td font-mono">{inv.job_code}</td>
                    <td className="td">{inv.customer_name}</td>
                    <td className="td">{inv.through_date}</td>
                    <td className="td text-right">{inv.grand_total ? formatMoney(inv.grand_total) : '—'}</td>
                    <td className="td"><Badge status={inv.status}>{inv.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    // Scope the draft to the visible date range so a "May 1–15" selection
    // doesn't pull in older unbilled entries the user can't see in the table.
    mutationFn: (job_id: string) => api.post<{ id: string }>('/invoices/draft', { job_id, from_date: from, through_date: to }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['job-totals'] }); nav({ to: '/invoices/$id', params: { id: r.id } }); },
    onError: (e: any) => {
      if (e.code === 'draft_exists' && e.details?.invoice_id) nav({ to: '/invoices/$id', params: { id: e.details.invoice_id } });
      else if (e.code === 'future_date') toast('The "to" date is in the future — set it to today or earlier to bill.', 'err');
      else toast(e.message, 'err');
    },
  });

  type BSort = 'code' | 'customer_name' | 'billing_type' | 'total_hours' | 'labor_amount' | 'expense_amount' | 'total_amount' | 'unbilled_count';
  const [bSort, setBSort] = useState<SortState<BSort>>({ key: 'total_amount', dir: 'desc' });
  const [bFilters, setBFilters] = useState({ code: '', customer_name: '', billing_type: '' as '' | 'tm' | 'quote', status: '' as '' | 'unbilled' | 'billed' });
  const bFilterActive = Object.values(bFilters).some(Boolean);
  const filteredJobs = useMemo(() => {
    const rows = data ?? [];
    const matches = rows.filter((r) =>
      (!bFilters.code || r.code.toLowerCase().includes(bFilters.code.toLowerCase())) &&
      (!bFilters.customer_name || r.customer_name.toLowerCase().includes(bFilters.customer_name.toLowerCase())) &&
      (!bFilters.billing_type || r.billing_type === bFilters.billing_type) &&
      (!bFilters.status || (bFilters.status === 'unbilled' ? Number(r.unbilled_count) > 0 : Number(r.unbilled_count) === 0)),
    );
    return [...matches].sort((a, b) => {
      const numerics: BSort[] = ['total_hours', 'labor_amount', 'expense_amount', 'total_amount', 'unbilled_count'];
      const av = numerics.includes(bSort.key) ? Number((a as any)[bSort.key] ?? 0) : (a as any)[bSort.key];
      const bv = numerics.includes(bSort.key) ? Number((b as any)[bSort.key] ?? 0) : (b as any)[bSort.key];
      return compareValues(av, bv, bSort.dir);
    });
  }, [data, bFilters, bSort]);

  const totals = filteredJobs.reduce(
    (a, r) => ({ labor: a.labor + Number(r.labor_amount), exp: a.exp + Number(r.expense_amount), total: a.total + Number(r.total_amount), hours: a.hours + Number(r.total_hours) }),
    { labor: 0, exp: 0, total: 0, hours: 0 },
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div><label className="label">Customer</label>
          <SearchSelect
            className="max-w-xs"
            value={customerId}
            onChange={setCustomerId}
            options={(customers ?? []).map((c) => ({ value: c.id, label: c.name }))}
            placeholder="All customers"
            allowClear
          />
        </div>
        <a className="btn-ghost" href={`/api/reports/job-totals?from=${from}&to=${to}${customerId ? `&customer_id=${customerId}` : ''}&format=csv`}><Download size={15} /> CSV</a>
      </div>

      {isFetching ? <Skeleton rows={5} /> : !data?.length ? <Empty title="No job activity in this range" hint="Adjust the dates or customer" /> : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs text-muted">
            <span>{filteredJobs.length} of {data.length} job{data.length === 1 ? '' : 's'}</span>
            {bFilterActive && <button className="text-copper hover:underline" onClick={() => setBFilters({ code: '', customer_name: '', billing_type: '', status: '' })}>Clear filters</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <SortableHeader<BSort> label="Job" sortKey="code" sort={bSort} onSort={(k) => setBSort((s) => nextSort(s, k))} />
                  <SortableHeader<BSort> label="Customer" sortKey="customer_name" sort={bSort} onSort={(k) => setBSort((s) => nextSort(s, k))} />
                  <SortableHeader<BSort> label="Type" sortKey="billing_type" sort={bSort} onSort={(k) => setBSort((s) => nextSort(s, k))} />
                  <SortableHeader<BSort> label="Hours" sortKey="total_hours" sort={bSort} onSort={(k) => setBSort((s) => nextSort(s, k))} align="right" />
                  <SortableHeader<BSort> label="Labor" sortKey="labor_amount" sort={bSort} onSort={(k) => setBSort((s) => nextSort(s, k))} align="right" />
                  <SortableHeader<BSort> label="Expenses" sortKey="expense_amount" sort={bSort} onSort={(k) => setBSort((s) => nextSort(s, k))} align="right" />
                  <SortableHeader<BSort> label="Total" sortKey="total_amount" sort={bSort} onSort={(k) => setBSort((s) => nextSort(s, k))} align="right" />
                  <SortableHeader<BSort> label="Status" sortKey="unbilled_count" sort={bSort} onSort={(k) => setBSort((s) => nextSort(s, k))} />
                  <th className="th"></th>
                </tr>
                <tr className="bg-paper/50">
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" placeholder="filter…" value={bFilters.code} onChange={(e) => setBFilters({ ...bFilters, code: e.target.value })} /></th>
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" placeholder="filter…" value={bFilters.customer_name} onChange={(e) => setBFilters({ ...bFilters, customer_name: e.target.value })} /></th>
                  <th className="px-3 py-1.5">
                    <SearchSelect value={bFilters.billing_type} onChange={(v) => setBFilters({ ...bFilters, billing_type: v as any })} options={[{ value: 'tm', label: 'T&M' }, { value: 'quote', label: 'Quote' }]} placeholder="all" allowClear />
                  </th>
                  <th colSpan={4}></th>
                  <th className="px-3 py-1.5">
                    <SearchSelect value={bFilters.status} onChange={(v) => setBFilters({ ...bFilters, status: v as any })} options={[{ value: 'unbilled', label: 'unbilled' }, { value: 'billed', label: 'billed' }]} placeholder="all" allowClear />
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.length === 0 ? (
                  <tr><td colSpan={9} className="td text-center text-muted">No jobs match the current filters</td></tr>
                ) : filteredJobs.map((r) => (
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
                  <td className="td" colSpan={3}>Totals ({filteredJobs.length} job{filteredJobs.length === 1 ? '' : 's'})</td>
                  <td className="td text-right">{totals.hours}</td>
                  <td className="td text-right">{formatMoney(totals.labor)}</td>
                  <td className="td text-right">{formatMoney(totals.exp)}</td>
                  <td className="td text-right">{formatMoney(totals.total)}</td>
                  <td className="td" colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>
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
  const m = useMutation({
    mutationFn: () => api.post<{ id: string }>('/invoices/draft', { job_id, through_date }),
    onSuccess: (r) => onCreated(r.id),
    onError: (e: any) => {
      // The API returns a structured 409 when a draft already exists for the
      // job — surface a clear message + jump directly to the existing draft
      // rather than the cryptic generic error.
      if (e.code === 'draft_exists' && e.details?.invoice_id) {
        toast('A draft already exists for this job — opening it', 'ok');
        onCreated(e.details.invoice_id);
        return;
      }
      toast(e.message ?? String(e), 'err');
    },
  });
  return (
    <Modal open onClose={onClose} title="New Invoice Draft">
      <div className="space-y-3">
        <div><label className="label">Job</label>
          <SearchSelect
            value={job_id}
            onChange={setJob}
            options={(jobs?.jobs ?? []).map((j: any) => ({ value: j.id, label: j.code, sublabel: j.description }))}
            placeholder="Select…"
          />
        </div>
        <div><label className="label">Through date</label><input type="date" className="input" value={through_date} onChange={(e) => setThrough(e.target.value)} /></div>
        <p className="text-xs text-muted">All unbilled time &amp; expenses on/before this date will be auto-selected.</p>
        <div className="flex justify-end gap-2 pt-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => m.mutate()} disabled={!job_id || m.isPending}>Create draft</button></div>
      </div>
    </Modal>
  );
}

// ─── Summary invoices ──────────────────────────────────────────────────────

interface SummaryRow { id: string; billed_reference: string; status: string; grand_total: string | null; customer_name: string; member_count: number; finalized_at: string | null; created_at: string; work_start_date: string | null; work_end_date: string | null; pdf_status: string | null; }
interface EligibleInvoice { id: string; billed_reference: string; through_date: string; grand_total: string; job_code: string; job_description: string; }

type SSort = 'billed_reference' | 'customer_name' | 'member_count' | 'work_start_date' | 'grand_total' | 'status';

function SummariesPanel() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['summaries'], queryFn: () => api.get<SummaryRow[]>('/invoice-summaries') });
  const [sort, setSort] = useState<SortState<SSort>>({ key: 'work_start_date', dir: 'desc' });
  const [filters, setFilters] = useState({ billed_reference: '', customer_name: '', status: '' as '' | 'draft' | 'finalized' | 'void' });
  const filterActive = Object.values(filters).some(Boolean);
  const filtered = useMemo(() => {
    const rows = data ?? [];
    const matches = rows.filter((r) =>
      (!filters.billed_reference || r.billed_reference.toLowerCase().includes(filters.billed_reference.toLowerCase())) &&
      (!filters.customer_name || r.customer_name.toLowerCase().includes(filters.customer_name.toLowerCase())) &&
      (!filters.status || r.status === filters.status),
    );
    return [...matches].sort((a, b) => {
      const numeric: SSort[] = ['member_count', 'grand_total'];
      const av = numeric.includes(sort.key) ? Number((a as any)[sort.key] ?? 0) : (a as any)[sort.key];
      const bv = numeric.includes(sort.key) ? Number((b as any)[sort.key] ?? 0) : (b as any)[sort.key];
      return compareValues(av, bv, sort.dir);
    });
  }, [data, filters, sort]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted">Bundle finalized invoices for one customer into a single billing document.</p>
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New Summary</button>
      </div>
      {isLoading ? <Skeleton /> : !data?.length ? <Empty title="No summary invoices yet" hint="Group several finalized invoices for a customer into one document" /> : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs text-muted">
            <span>{filtered.length} of {data.length} summary{data.length === 1 ? '' : 's'}</span>
            {filterActive && <button className="text-copper hover:underline" onClick={() => setFilters({ billed_reference: '', customer_name: '', status: '' })}>Clear filters</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <SortableHeader<SSort> label="Number" sortKey="billed_reference" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                  <SortableHeader<SSort> label="Customer" sortKey="customer_name" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                  <SortableHeader<SSort> label="Members" sortKey="member_count" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} align="right" />
                  <SortableHeader<SSort> label="Dates" sortKey="work_start_date" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                  <SortableHeader<SSort> label="Total" sortKey="grand_total" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} align="right" />
                  <SortableHeader<SSort> label="Status" sortKey="status" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                </tr>
                <tr className="bg-paper/50">
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" placeholder="filter…" value={filters.billed_reference} onChange={(e) => setFilters({ ...filters, billed_reference: e.target.value })} /></th>
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" placeholder="filter…" value={filters.customer_name} onChange={(e) => setFilters({ ...filters, customer_name: e.target.value })} /></th>
                  <th colSpan={3}></th>
                  <th className="px-3 py-1.5">
                    <SearchSelect value={filters.status} onChange={(v) => setFilters({ ...filters, status: v as any })} options={[{ value: 'draft', label: 'draft' }, { value: 'finalized', label: 'finalized' }, { value: 'void', label: 'void' }]} placeholder="all" allowClear />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="td text-center text-muted">No summaries match the current filters</td></tr>
                ) : filtered.map((s) => (
                  <tr key={s.id} className="cursor-pointer hover:bg-paper" onClick={() => nav({ to: '/invoice-summaries/$id', params: { id: s.id } })}>
                    <td className="td font-mono font-medium">{s.billed_reference}</td>
                    <td className="td">{s.customer_name}</td>
                    <td className="td text-right">{s.member_count}</td>
                    <td className="td">{s.work_start_date && s.work_end_date ? `${s.work_start_date} → ${s.work_end_date}` : '—'}</td>
                    <td className="td text-right">{s.grand_total ? formatMoney(s.grand_total) : '—'}</td>
                    <td className="td"><Badge status={s.status}>{s.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {creating && <NewSummaryModal onClose={() => setCreating(false)} onCreated={(id) => { qc.invalidateQueries({ queryKey: ['summaries'] }); nav({ to: '/invoice-summaries/$id', params: { id } }); }} />}
    </div>
  );
}

function NewSummaryModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: () => api.get<any[]>('/customers') });
  const [customerId, setCustomerId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [billedRef, setBilledRef] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const { data: eligible } = useQuery({
    queryKey: ['summary-eligible', customerId],
    queryFn: () => api.get<EligibleInvoice[]>(`/invoice-summaries/eligible-invoices?customer_id=${customerId}`),
    enabled: !!customerId,
  });
  // Auto-suggest billed reference + date range when selection changes.
  const memberIds = useMemo(() => [...selected], [selected]);
  const memberCsv = memberIds.join(',');
  const { data: suggest } = useQuery({
    queryKey: ['summary-suggest', customerId, memberCsv],
    queryFn: () => api.get<{ billed_reference: string; work_start_date: string | null; work_end_date: string | null }>(`/invoice-summaries/suggest-number?customer_id=${customerId}&member_ids=${memberCsv}`),
    enabled: !!customerId && selected.size > 0,
  });
  // Seed defaults from the suggestion (only if the operator hasn't typed yet).
  // Running this in render trips React's "Cannot update during render"
  // warning; use an effect keyed on the suggestion identity.
  useEffect(() => {
    if (suggest && !billedRef) setBilledRef(suggest.billed_reference);
    if (suggest && !start && suggest.work_start_date) setStart(suggest.work_start_date);
    if (suggest && !end && suggest.work_end_date) setEnd(suggest.work_end_date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggest]);

  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/invoice-summaries', {
      customer_id: customerId,
      member_invoice_ids: memberIds,
      billed_reference: billedRef.trim() || undefined,
      description,
      po_number: poNumber || null,
      location_of_service: location || null,
      work_start_date: start || null,
      work_end_date: end || null,
    }),
    onSuccess: (r) => { toast('Summary draft created'); onCreated(r.id); },
    onError: (e: any) => toast(e.message, 'err'),
  });

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    setBilledRef(''); setStart(''); setEnd(''); // re-suggest on next fetch
  }

  return (
    <Modal open onClose={onClose} title="New Summary Invoice" wide>
      <div className="space-y-4">
        <div>
          <label className="label">Customer</label>
          <SearchSelect
            value={customerId}
            onChange={(v) => { setCustomerId(v); setSelected(new Set()); setBilledRef(''); setStart(''); setEnd(''); }}
            options={(customers ?? []).filter((c: any) => c.active).map((c: any) => ({ value: c.id, label: c.name }))}
            placeholder="Select customer…"
          />
        </div>
        {customerId && (
          <div>
            <div className="mb-1 text-sm font-semibold">Eligible finalized invoices <span className="text-muted">({eligible?.length ?? 0})</span></div>
            {(!eligible || eligible.length === 0) ? (
              <div className="rounded-lg border border-line p-3 text-sm text-muted">No finalized invoices for this customer that aren't already in another summary.</div>
            ) : (
              <div className="max-h-60 overflow-y-auto rounded-lg border border-line">
                {eligible.map((inv) => (
                  <label key={inv.id} className="flex cursor-pointer items-center gap-2 border-b border-line px-3 py-1.5 text-sm last:border-b-0 hover:bg-paper">
                    <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggle(inv.id)} />
                    <span className="font-mono">{inv.billed_reference}</span>
                    <span className="font-mono text-muted">{inv.job_code}</span>
                    <span className="flex-1 truncate text-muted">{inv.job_description}</span>
                    <span className="font-semibold">{formatMoney(inv.grand_total)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        {selected.size > 0 && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Invoice number</label>
                <input className="input font-mono" value={billedRef} onChange={(e) => setBilledRef(e.target.value)} placeholder={suggest?.billed_reference ?? '—'} />
                <p className="mt-1 text-xs text-muted">Defaults to <span className="font-mono">{suggest?.billed_reference ?? '…'}</span></p>
              </div>
              <div>
                <label className="label">P.O. number</label>
                <input className="input" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Location of Service</label>
              <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Frontenac, KS" />
            </div>
            <div>
              <label className="label">Description of Work</label>
              <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Start</label><input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></div>
              <div><label className="label">End</label><input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => create.mutate()} disabled={!customerId || selected.size === 0 || create.isPending}>Create draft</button>
        </div>
      </div>
    </Modal>
  );
}
