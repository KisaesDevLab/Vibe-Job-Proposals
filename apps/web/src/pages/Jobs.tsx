import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { Modal, Skeleton, Empty, Badge, toast } from '@/components/ui';
import { SearchSelect } from '@/components/SearchSelect';

interface Job {
  id: string;
  code: string;
  customerId: string;
  customerName: string;
  description: string;
  poNumber: string | null;
  billingType: 'tm' | 'quote';
  active: boolean;
  invoiceCount: number;
}
interface Customer { id: string; name: string; active: boolean; }

type SortKey = 'code' | 'customerName' | 'description' | 'billingType' | 'invoiceCount' | 'active';
type SortDir = 'asc' | 'desc';

interface Filters {
  code: string;
  customerName: string;
  description: string;
  billingType: '' | 'tm' | 'quote';
  invoiceCountMin: string;
  active: '' | 'true' | 'false';
}
const EMPTY_FILTERS: Filters = { code: '', customerName: '', description: '', billingType: '', invoiceCountMin: '', active: '' };

export function JobsPage() {
  const qc = useQueryClient();
  // Load the full active set client-side so column sort + filter feel instant.
  const { data, isLoading } = useQuery({ queryKey: ['jobs'], queryFn: () => api.get<{ jobs: Job[] }>('/jobs?pageSize=500') });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'code', dir: 'asc' });

  const filtered = useMemo(() => {
    const rows = data?.jobs ?? [];
    const f = filters;
    const min = Number(f.invoiceCountMin || 0);
    const matches = rows.filter((r) =>
      (!f.code || r.code.toLowerCase().includes(f.code.toLowerCase())) &&
      (!f.customerName || r.customerName.toLowerCase().includes(f.customerName.toLowerCase())) &&
      (!f.description || r.description.toLowerCase().includes(f.description.toLowerCase())) &&
      (!f.billingType || r.billingType === f.billingType) &&
      (!f.invoiceCountMin || r.invoiceCount >= min) &&
      (!f.active || String(r.active) === f.active),
    );
    const dir = sort.dir === 'asc' ? 1 : -1;
    matches.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === bv) return 0;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      // booleans + strings: stable string-ish compare
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
    return matches;
  }, [data, filters, sort]);

  function clickSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }
  function setFilter<K extends keyof Filters>(k: K, v: Filters[K]) {
    setFilters((f) => ({ ...f, [k]: v }));
  }
  const clear = () => setFilters(EMPTY_FILTERS);
  const filterActive = Object.values(filters).some(Boolean);

  return (
    <div>
      <PageHeader title="Jobs" subtitle="Work orders by customer"
        actions={<>
          <a className="btn-ghost" href="/api/jobs/export/csv">Export CSV</a>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New Job</button>
        </>} />
      {isLoading ? <Skeleton /> : !data?.jobs.length ? <Empty title="No jobs found" /> : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs text-muted">
            <span>{filtered.length} of {data.jobs.length} job{data.jobs.length === 1 ? '' : 's'}</span>
            {filterActive && <button className="text-copper hover:underline" onClick={clear}>Clear filters</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <SortableHeader label="Code" sortKey="code" sort={sort} onSort={clickSort} />
                  <SortableHeader label="Customer" sortKey="customerName" sort={sort} onSort={clickSort} />
                  <SortableHeader label="Description" sortKey="description" sort={sort} onSort={clickSort} />
                  <SortableHeader label="Type" sortKey="billingType" sort={sort} onSort={clickSort} />
                  <SortableHeader label="Invoices" sortKey="invoiceCount" sort={sort} onSort={clickSort} align="right" />
                  <SortableHeader label="Status" sortKey="active" sort={sort} onSort={clickSort} />
                </tr>
                <tr className="bg-paper/50">
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" placeholder="filter…" value={filters.code} onChange={(e) => setFilter('code', e.target.value)} /></th>
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" placeholder="filter…" value={filters.customerName} onChange={(e) => setFilter('customerName', e.target.value)} /></th>
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" placeholder="filter…" value={filters.description} onChange={(e) => setFilter('description', e.target.value)} /></th>
                  <th className="px-3 py-1.5">
                    <SearchSelect
                      value={filters.billingType}
                      onChange={(v) => setFilter('billingType', v as Filters['billingType'])}
                      options={[{ value: 'tm', label: 'T&M' }, { value: 'quote', label: 'Quote' }]}
                      placeholder="all"
                      allowClear
                    />
                  </th>
                  <th className="px-3 py-1.5"><input className="input h-8 py-1 text-xs" inputMode="numeric" placeholder="≥" value={filters.invoiceCountMin} onChange={(e) => setFilter('invoiceCountMin', e.target.value.replace(/[^0-9]/g, ''))} /></th>
                  <th className="px-3 py-1.5">
                    <SearchSelect
                      value={filters.active}
                      onChange={(v) => setFilter('active', v as Filters['active'])}
                      options={[{ value: 'true', label: 'active' }, { value: 'false', label: 'inactive' }]}
                      placeholder="all"
                      allowClear
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="td text-center text-muted">No jobs match the current filters</td></tr>
                ) : filtered.map((j) => (
                  <tr key={j.id} className="cursor-pointer hover:bg-paper" onClick={() => setEditing(j)}>
                    <td className="td font-mono font-medium">{j.code}</td>
                    <td className="td">{j.customerName}</td>
                    <td className="td">{j.description}</td>
                    <td className="td"><Badge status={j.billingType}>{j.billingType === 'tm' ? 'T&M' : 'Quote'}</Badge></td>
                    <td className="td text-right">{j.invoiceCount}</td>
                    <td className="td">{j.active ? <Badge status="finalized">active</Badge> : <Badge status="void">inactive</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {creating && <JobForm onClose={() => setCreating(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['jobs-active'] }); setCreating(false); }} />}
      {editing && <JobForm jobId={editing.id} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['jobs-active'] }); setEditing(null); }} />}
    </div>
  );
}

function SortableHeader({ label, sortKey, sort, onSort, align }: { label: string; sortKey: SortKey; sort: { key: SortKey; dir: SortDir }; onSort: (k: SortKey) => void; align?: 'left' | 'right' }) {
  const active = sort.key === sortKey;
  const justify = align === 'right' ? 'justify-end' : 'justify-start';
  return (
    <th className="th cursor-pointer select-none hover:text-ink" onClick={() => onSort(sortKey)}>
      <span className={`inline-flex items-center gap-1 ${justify}`}>
        {label}
        {active ? (sort.dir === 'asc' ? <ArrowUp size={12} className="text-copper" /> : <ArrowDown size={12} className="text-copper" />) : <ArrowUpDown size={12} className="text-line" />}
      </span>
    </th>
  );
}

function JobForm({ jobId, onClose, onSaved }: { jobId?: string; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!jobId;
  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: () => api.get<Customer[]>('/customers') });
  const { data: existing, isLoading } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.get<any>(`/jobs/${jobId}`),
    enabled: isEdit,
  });
  const [f, setF] = useState({ code: '', customer_id: '', description: '', po_number: '', billing_type: 'tm', active: true });
  const [seeded, setSeeded] = useState(false);
  if (isEdit && existing && !seeded) {
    setF({
      code: existing.code ?? '',
      customer_id: existing.customerId ?? '',
      description: existing.description ?? '',
      po_number: existing.poNumber ?? '',
      billing_type: existing.billingType ?? 'tm',
      active: existing.active ?? true,
    });
    setSeeded(true);
  }
  const m = useMutation({
    mutationFn: () => isEdit
      ? api.put(`/jobs/${jobId}`, { ...f, po_number: f.po_number || null })
      : api.post('/jobs', { ...f, po_number: f.po_number || null }),
    onSuccess: () => { toast(isEdit ? 'Job updated' : 'Job created'); onSaved(); },
    onError: (e: any) => toast(e.message, 'err'),
  });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit Job — ${existing?.code ?? ''}` : 'New Job'}>
      {isEdit && isLoading ? <Skeleton rows={4} /> : (
        <div className="space-y-3">
          <div><label className="label">Code <span className="text-muted">(e.g., D26NB048)</span></label><input className="input font-mono" value={f.code} onChange={set('code')} /></div>
          <div><label className="label">Customer</label>
            <SearchSelect
              value={f.customer_id}
              onChange={(v) => setF({ ...f, customer_id: v })}
              options={(customers ?? []).filter((c) => c.active || c.id === f.customer_id).map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Select…"
            />
          </div>
          <div><label className="label">Description</label><input className="input" value={f.description} onChange={set('description')} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">PO number</label><input className="input" value={f.po_number} onChange={set('po_number')} /></div>
            <div><label className="label">Billing type</label>
              <SearchSelect
                value={f.billing_type}
                onChange={(v) => setF({ ...f, billing_type: v })}
                options={[{ value: 'tm', label: 'Time & Materials' }, { value: 'quote', label: 'Quote' }]}
              />
            </div>
          </div>
          {isEdit && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
              <span>{f.active ? 'Active' : 'Inactive'} <span className="text-muted">— inactive jobs are hidden from new time/expense pickers</span></span>
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={() => m.mutate()} disabled={!f.code || !f.customer_id || !f.description || m.isPending}>{isEdit ? 'Save changes' : 'Save'}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
