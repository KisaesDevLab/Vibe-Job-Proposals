import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@darrow/shared';
import { PageHeader } from '@/components/Layout';
import { Empty } from '@/components/ui';
import { SearchSelect } from '@/components/SearchSelect';

const PER_JOB_REPORTS = [
  { key: 'employee-hours', label: 'Hours by Employee' },
  { key: 'time-detail', label: 'Time Detail (hours only)' },
  { key: 'time-billing-log', label: 'Time Billing Log (rate + $)' },
  { key: 'expense-list', label: 'Expense List' },
] as const;

export function ReportsPage() {
  const [tab, setTab] = useState<'per-job' | 'job-profit' | 'rate-sheet'>('per-job');
  return (
    <div>
      <PageHeader title="Reports" subtitle="Hours, expenses, profitability & rates" />
      <div className="mb-5 flex gap-2 border-b border-line">
        <button onClick={() => setTab('per-job')} className={`px-3 py-2 text-sm font-medium ${tab === 'per-job' ? 'border-b-2 border-copper text-copper' : 'text-muted'}`}>Per-job reports</button>
        <button onClick={() => setTab('job-profit')} className={`px-3 py-2 text-sm font-medium ${tab === 'job-profit' ? 'border-b-2 border-copper text-copper' : 'text-muted'}`}>Job profit</button>
        <button onClick={() => setTab('rate-sheet')} className={`px-3 py-2 text-sm font-medium ${tab === 'rate-sheet' ? 'border-b-2 border-copper text-copper' : 'text-muted'}`}>Customer rate sheet</button>
      </div>
      {tab === 'per-job' ? <PerJobReports /> : tab === 'job-profit' ? <JobProfitReport /> : <RateSheet />}
    </div>
  );
}

interface RateSheetRow { employee_id: string; employee: string; level: string; rate_1x: string; rate_15x: string; rate_2x: string; missing: boolean; }

function RateSheet() {
  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: () => api.get<{ id: string; name: string; active: boolean }[]>('/customers') });
  const [customerId, setCustomerId] = useState('');
  const { data, isFetching } = useQuery({
    queryKey: ['rate-sheet', customerId],
    queryFn: () => api.get<RateSheetRow[]>(`/reports/customer-rate-sheet?customer_id=${customerId}`),
    enabled: !!customerId,
  });
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchSelect
          className="max-w-xs"
          value={customerId}
          onChange={setCustomerId}
          options={(customers ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Select customer…"
          allowClear
        />
        {customerId && <a className="btn-ghost" href={`/api/reports/customer-rate-sheet?customer_id=${customerId}&format=csv`}><Download size={15} /> CSV</a>}
      </div>
      {!customerId ? <Empty title="Select a customer to see active-employee rates" hint="Uses the rate schedule covering today" />
        : isFetching ? <Empty title="Loading…" />
        : !data?.length ? <Empty title="No active employees" />
        : (() => {
            const anyMissing = data.some((r) => r.missing);
            return (
              <>
                {anyMissing && (
                  <div className="mb-3 rounded bg-amber-soft p-2 text-xs text-amber">
                    Some rows have no rate line — the customer's current schedule is missing entries for those levels.
                  </div>
                )}
                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr><th className="th">Employee</th><th className="th">Level</th><th className="th text-right">ST (1×)</th><th className="th text-right">OT (1.5×)</th><th className="th text-right">DT (2×)</th></tr></thead>
                    <tbody>
                      {data.map((r) => (
                        <tr key={r.employee_id} className={r.missing ? 'text-red' : ''}>
                          <td className="td font-medium">{r.employee}</td>
                          <td className="td">{r.level}</td>
                          <td className="td text-right">{r.missing ? '—' : formatMoney(r.rate_1x)}</td>
                          <td className="td text-right">{r.missing ? '—' : formatMoney(r.rate_15x)}</td>
                          <td className="td text-right">{r.missing ? '—' : formatMoney(r.rate_2x)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
    </div>
  );
}

function PerJobReports() {
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
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchSelect
          className="max-w-xs"
          value={report}
          onChange={setReport}
          options={PER_JOB_REPORTS.map((r) => ({ value: r.key, label: r.label }))}
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
            <tbody>
              {data.map((row, i) => (
                <tr key={i}>
                  {Object.entries(row).map(([k, v], j) => (
                    <td key={j} className={`td ${isNumericCol(k) ? 'text-right' : ''}`}>{formatCell(k, v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Customer { id: string; name: string; active: boolean; }
interface Job { id: string; code: string; description: string; customerId: string; invoiceCount: number; }
interface ProfitRow { job_id: string; code: string; description: string; billing_type: string; customer_name: string; billed_labor: string; labor_cost: string; expense_markup: string; profit: string; invoice_count: number; }

function JobProfitReport() {
  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: () => api.get<Customer[]>('/customers') });
  const { data: jobsResp } = useQuery({ queryKey: ['jobs', 'all'], queryFn: () => api.get<{ jobs: Job[] }>('/jobs?pageSize=500') });
  const [customerId, setCustomerId] = useState('');
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [commissionPct, setCommissionPct] = useState(''); // entered as percent string, e.g. "10" → 0.10

  // Filter jobs by selected customer. Switching the customer resets selection.
  const jobsForCustomer = useMemo(() => {
    if (!customerId || !jobsResp) return [];
    return jobsResp.jobs.filter((j) => j.customerId === customerId);
  }, [jobsResp, customerId]);

  const jobIdsCsv = useMemo(() => [...selectedJobs].join(','), [selectedJobs]);
  const { data: rows, isFetching } = useQuery({
    queryKey: ['job-profit', jobIdsCsv],
    queryFn: () => api.get<ProfitRow[]>(`/reports/job-profit?job_ids=${jobIdsCsv}`),
    enabled: selectedJobs.size > 0,
  });

  const totals = useMemo(() => {
    if (!rows) return { billed_labor: 0, labor_cost: 0, expense_markup: 0, profit: 0 };
    return rows.reduce(
      (a, r) => ({
        billed_labor: a.billed_labor + Number(r.billed_labor),
        labor_cost: a.labor_cost + Number(r.labor_cost),
        expense_markup: a.expense_markup + Number(r.expense_markup),
        profit: a.profit + Number(r.profit),
      }),
      { billed_labor: 0, labor_cost: 0, expense_markup: 0, profit: 0 },
    );
  }, [rows]);

  const commissionRate = Number(commissionPct || 0) / 100;
  const commissionDollar = totals.profit * (Number.isFinite(commissionRate) ? commissionRate : 0);

  function toggleJob(id: string) {
    setSelectedJobs((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAll() { setSelectedJobs(new Set(jobsForCustomer.map((j) => j.id))); }
  function clearAll() { setSelectedJobs(new Set()); }

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="label">Customer</label>
          <SearchSelect
            value={customerId}
            onChange={(v) => { setCustomerId(v); setSelectedJobs(new Set()); }}
            options={(customers ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select customer…"
            allowClear
          />
        </div>
        <div>
          <label className="label">Commission %</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="e.g. 5"
            value={commissionPct}
            onChange={(e) => setCommissionPct(e.target.value.replace(/[^0-9.]/g, ''))}
          />
        </div>
        <div className="flex items-end">
          {selectedJobs.size > 0 && (
            <a
              className="btn-ghost"
              href={`/api/reports/job-profit?job_ids=${jobIdsCsv}&format=csv`}
            >
              <Download size={15} /> CSV
            </a>
          )}
        </div>
      </div>

      {!customerId ? (
        <Empty title="Select a customer to choose jobs" />
      ) : jobsForCustomer.length === 0 ? (
        <Empty title="This customer has no jobs" />
      ) : (
        <>
          <div className="card mb-4 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">
                Jobs <span className="text-muted">({selectedJobs.size} of {jobsForCustomer.length} selected)</span>
              </div>
              <div className="flex gap-2 text-xs">
                <button className="text-copper hover:underline" onClick={selectAll}>Select all</button>
                <button className="text-muted hover:underline" onClick={clearAll}>Clear</button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
              {jobsForCustomer.map((j) => (
                <label key={j.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-paper">
                  <input
                    type="checkbox"
                    checked={selectedJobs.has(j.id)}
                    onChange={() => toggleJob(j.id)}
                  />
                  <span className="font-mono">{j.code}</span>
                  <span className="truncate text-muted">{j.description}</span>
                </label>
              ))}
            </div>
          </div>

          {selectedJobs.size === 0 ? (
            <Empty title="Select one or more jobs to see profit" />
          ) : isFetching ? (
            <Empty title="Loading…" />
          ) : !rows?.length ? (
            <Empty title="No finalized invoices for the selected jobs" />
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Job</th>
                    <th className="th">Description</th>
                    <th className="th text-right">Billed labor</th>
                    <th className="th text-right">Labor cost</th>
                    <th className="th text-right">Expense markup</th>
                    <th className="th text-right">Profit</th>
                    <th className="th text-right">Invoices</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.job_id} className="hover:bg-paper">
                      <td className="td font-mono font-medium">{r.code}</td>
                      <td className="td">{r.description}</td>
                      <td className="td text-right">{formatMoney(r.billed_labor)}</td>
                      <td className="td text-right">{formatMoney(r.labor_cost)}</td>
                      <td className="td text-right">{formatMoney(r.expense_markup)}</td>
                      <td className="td text-right font-semibold">{formatMoney(r.profit)}</td>
                      <td className="td text-right">{r.invoice_count}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-line font-semibold">
                    <td className="td" colSpan={2}>Totals ({rows.length} jobs)</td>
                    <td className="td text-right">{formatMoney(totals.billed_labor)}</td>
                    <td className="td text-right">{formatMoney(totals.labor_cost)}</td>
                    <td className="td text-right">{formatMoney(totals.expense_markup)}</td>
                    <td className="td text-right">{formatMoney(totals.profit)}</td>
                    <td className="td"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {selectedJobs.size > 0 && rows && rows.length > 0 && (
            <div className="card mt-4 p-4">
              <div className="text-sm font-semibold">Commission</div>
              <p className="mt-1 text-xs text-muted">
                Profit = billed labor − labor cost + expense markup. Commission $ = total profit × commission %.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div>
                  <div className="text-xs text-muted">Total profit</div>
                  <div className="text-lg font-semibold">{formatMoney(totals.profit)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted">Commission rate</div>
                  <div className="text-lg font-semibold">{commissionPct ? `${commissionPct}%` : '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted">Commission $</div>
                  <div className="text-lg font-semibold text-copper">{commissionPct ? formatMoney(commissionDollar) : '—'}</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Per-job-reports table formatter — JSON rows come back with raw numeric
// strings (numeric(10,2) → "1234.56"). The table previously rendered them
// verbatim; we want commas on every numeric column and a "$" on dollar
// columns. Anything whose key looks like a dollar field gets formatMoney;
// other numerics still get thousands separators.
const NUM_FMT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const MONEY_KEYS = /(^|_)(amount|total|cost|rate|markup|profit|labor|expense|billed|grand)(_|$)/i;
function isNumericVal(v: unknown): boolean {
  if (v == null || v === '') return false;
  if (typeof v === 'number') return isFinite(v);
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return false;
    return /^-?\d+(\.\d+)?$/.test(s);
  }
  return false;
}
function isNumericCol(key: string): boolean {
  return /(^|_)(amount|total|cost|rate|markup|profit|labor|expense|billed|grand|hours|qty|count|st|ot|dt)(_|$)/i.test(key);
}
function isMoneyCol(key: string): boolean {
  return MONEY_KEYS.test(key);
}
function formatCell(key: string, v: unknown): string {
  if (v == null || v === '') return '';
  if (isNumericVal(v)) {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return isMoneyCol(key) ? formatMoney(n) : NUM_FMT.format(n);
  }
  return String(v);
}
