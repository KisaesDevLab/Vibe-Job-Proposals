import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Download, FileText, Ban, RefreshCw, Mail, Package, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@darrow/shared';
import { Skeleton, Badge, Modal, toast } from '@/components/ui';

export function InvoiceDetailPage({ id }: { id: string }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get<any>(`/invoices/${id}`),
    refetchInterval: (q) => {
      const inv = q.state.data?.invoice;
      return inv && (inv.docx_status === 'pending' || inv.pdf_status === 'pending' || inv.package_status === 'pending') ? 3000 : false;
    },
  });
  const [voiding, setVoiding] = useState(false);
  const [emailing, setEmailing] = useState(false);

  const finalize = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/finalize`),
    onSuccess: () => { toast('Invoice finalized'); qc.invalidateQueries({ queryKey: ['invoice', id] }); qc.invalidateQueries({ queryKey: ['invoices'] }); },
    onError: (e: any) => {
      // `e.details` is sometimes an array of blocker objects, sometimes
      // undefined (plain HttpError). Guard against the non-array case to
      // avoid the cryptic `[object Object]` toast we used to show.
      const detail = Array.isArray(e.details) ? e.details.map((b: any) => b.message ?? String(b)).join('; ') : null;
      toast(detail ? `Blocked: ${detail}` : (e.message ?? String(e)), 'err');
    },
  });
  const regenerate = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/regenerate`),
    onSuccess: () => { toast('Regenerating'); qc.invalidateQueries({ queryKey: ['invoice', id] }); },
    onError: (e: any) => toast(e.message ?? String(e), 'err'),
  });
  const discard = useMutation({
    mutationFn: () => api.del(`/invoices/${id}`),
    onSuccess: () => {
      toast('Draft discarded — time & expenses are unbilled again');
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['job-totals'] });
      nav({ to: '/invoices' });
    },
    onError: (e: any) => toast(e.message ?? String(e), 'err'),
  });

  if (isLoading) return <Skeleton rows={8} />;
  const inv = data.invoice;
  const isDraft = inv.status === 'draft';

  return (
    <div>
      <button className="btn-ghost mb-4" onClick={() => nav({ to: '/invoices' })}><ArrowLeft size={16} /> Invoices</button>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{inv.billed_reference ?? 'Draft Invoice'}</h1>
            <Badge status={inv.status}>{inv.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">{inv.job_code} · {inv.customer_name} · through {inv.through_date}</p>
        </div>
        <div className="flex gap-2">
          {isDraft && (
            <>
              <button
                className="btn-ghost text-red"
                onClick={() => {
                  if (confirm('Discard this draft? Time entries and expenses will become unbilled again. This cannot be undone.')) discard.mutate();
                }}
                disabled={discard.isPending}
                title="Discard draft — unbinds entries and deletes the draft"
              >
                <Trash2 size={15} /> Discard draft
              </button>
              <button className="btn-primary" onClick={() => finalize.mutate()} disabled={finalize.isPending || (data.preview?.blockers?.length > 0)}>Finalize</button>
            </>
          )}
          {!isDraft && inv.status !== 'void' && (
            <>
              <a
                className={`btn-ghost ${inv.docx_status !== 'ready' ? 'pointer-events-none opacity-50' : ''}`}
                href={`/api/invoices/${id}/docx`}
                title={
                  inv.docx_status === 'ready' ? 'Download DOCX'
                  : inv.docx_status === 'failed' ? `DOCX failed — click Regenerate to retry${inv.generation_error ? `: ${inv.generation_error}` : ''}`
                  : `DOCX ${inv.docx_status ?? 'pending'}…`
                }
              >
                <FileText size={15} /> DOCX{inv.docx_status === 'failed' ? ' (failed)' : inv.docx_status !== 'ready' ? ` (${inv.docx_status ?? 'pending'}…)` : ''}
              </a>
              <a
                className={`btn-ghost ${inv.pdf_status !== 'ready' ? 'pointer-events-none opacity-50' : ''}`}
                href={`/api/invoices/${id}/pdf`}
                title={
                  inv.pdf_status === 'ready' ? 'Download PDF'
                  : inv.pdf_status === 'failed' ? 'PDF failed — LibreOffice may not be installed. Use Package PDF instead, or install LibreOffice and click Regenerate.'
                  : `PDF ${inv.pdf_status ?? 'pending'}…`
                }
              >
                <Download size={15} /> PDF{inv.pdf_status === 'failed' ? ' (failed)' : inv.pdf_status !== 'ready' ? ` (${inv.pdf_status ?? 'pending'}…)` : ''}
              </a>
              <a
                className={`btn-primary ${inv.package_status !== 'ready' ? 'pointer-events-none opacity-50' : ''}`}
                href={`/api/invoices/${id}/package`}
                title={inv.package_status === 'ready' ? 'Download full package (proposal + summaries + receipts)' : `Package ${inv.package_status ?? 'pending'}`}
              >
                <Package size={15} /> Package PDF
              </a>
              <button className="btn-ghost" onClick={() => setEmailing(true)}><Mail size={15} /> Email</button>
              <button className="btn-ghost" onClick={() => regenerate.mutate()} disabled={regenerate.isPending} title="Regenerate DOCX/PDF/Package"><RefreshCw size={15} /></button>
              <button className="btn-danger" onClick={() => setVoiding(true)}><Ban size={15} /> Void</button>
            </>
          )}
        </div>
      </div>

      {isDraft ? <DraftView id={id} data={data} /> : <SnapshotView inv={inv} lines={data.line_items} />}

      {voiding && <VoidModal id={id} reference={inv.billed_reference} onClose={() => setVoiding(false)} onVoided={() => { setVoiding(false); qc.invalidateQueries({ queryKey: ['invoice', id] }); qc.invalidateQueries({ queryKey: ['invoices'] }); }} />}
      {emailing && <EmailModal id={id} inv={inv} onClose={() => setEmailing(false)} />}
    </div>
  );
}

function EmailModal({ id, inv, onClose }: { id: string; inv: any; onClose: () => void }) {
  const { data: history, refetch } = useQuery({ queryKey: ['invoice-emails', id], queryFn: () => api.get<any[]>(`/invoices/${id}/emails`) });
  const [f, setF] = useState({
    to: inv.customer_contact_email ?? '',
    subject: `Invoice ${inv.billed_reference} from ${inv.company_name ?? 'Darrow Electric'}`,
    body: `Please find attached invoice ${inv.billed_reference} totaling ${formatMoney(inv.grand_total)}.`,
    include_docx: true,
    include_pdf: true,
  });
  const send = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/email`, { to: f.to, cc: [], subject: f.subject, body: f.body, include_docx: f.include_docx, include_pdf: f.include_pdf }),
    onSuccess: () => { toast('Email queued — sent from your address'); refetch(); },
    onError: (e: any) => toast(e.message, 'err'),
  });
  return (
    <Modal open onClose={onClose} title={`Email ${inv.billed_reference}`} wide>
      <div className="space-y-3">
        <p className="text-xs text-muted">Sends from your personal email settings (or the company relay as a fallback). Configure yours via the mail icon in the sidebar.</p>
        <div><label className="label">To</label><input className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
        <div><label className="label">Subject</label><input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></div>
        <div><label className="label">Body</label><textarea className="input h-28" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.include_pdf} onChange={(e) => setF({ ...f, include_pdf: e.target.checked })} /> attach PDF</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.include_docx} onChange={(e) => setF({ ...f, include_docx: e.target.checked })} /> attach DOCX</label>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={() => send.mutate()} disabled={!f.to || (!f.include_docx && !f.include_pdf) || send.isPending}>Send</button>
        </div>
        {!!history?.length && (
          <div className="mt-2 border-t border-line pt-2">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Send history</div>
            <div className="space-y-1">
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between text-sm">
                  <span>{h.toAddress}</span>
                  <span>{h.sentAt ? <Badge status="finalized">sent</Badge> : h.error ? <Badge status="failed">failed</Badge> : <Badge status="pending">queued</Badge>}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function DraftView({ data }: { id: string; data: any }) {
  const p = data.preview;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {p?.blockers?.length > 0 && (
          <div className="rounded-lg bg-red-soft p-3 text-sm text-red">
            <div className="font-semibold">Finalize blocked:</div>
            <ul className="list-disc pl-5">{p.blockers.map((b: any, i: number) => <li key={i}>{b.message}</li>)}</ul>
          </div>
        )}
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-2 text-sm font-semibold">Labor ({p?.labor_lines?.length ?? 0})</div>
          <table className="w-full text-sm">
            <tbody>
              {p?.labor_lines?.map((l: any, i: number) => (
                <tr key={i}><td className="td">{l.employee_name}</td><td className="td">{l.tier_label}</td><td className="td">{l.hours} hrs</td><td className="td">{formatMoney(l.rate)}</td><td className="td text-right">{formatMoney(l.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-2 text-sm font-semibold">Expenses ({p?.expense_lines?.length ?? 0})</div>
          <table className="w-full text-sm">
            <tbody>
              {p?.expense_lines?.map((l: any, i: number) => (
                <tr key={i}><td className="td">{l.category_label}</td><td className="td">{l.vendor}</td><td className="td">{formatMoney(l.amount)}</td><td className="td">+{formatMoney(l.markup_amount)} <span className="text-xs text-muted">({l.markup_source})</span></td><td className="td text-right">{formatMoney(l.total)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card h-fit p-4">
        <div className="mb-2 text-sm font-semibold">Preview Totals</div>
        <Totals t={p?.totals} />
      </div>
    </div>
  );
}

function SnapshotView({ inv, lines }: { inv: any; lines: any[] }) {
  // Collapse the snapshot's per-(time_entry, tier) labor rows into one row per
  // (employee, tier, rate). The DB stores one row per time entry × non-zero
  // tier so a finalize view for a 5-day-week, 8-employee crew would show 40+
  // labor rows; the operator wants to see "8 employees × 3 tiers = 24 rows"
  // at most. Subtotals, overhead, expenses, markups, and grand_total pass
  // through unchanged so the totals math is unaffected.
  const renderLines = useMemo(() => {
    const out: any[] = [];
    const groups = new Map<string, any>();
    const flush = () => {
      // Stable ordering when emitting: employee asc, tier ST → OT → DT.
      const tierOrder = (t: string | null) => t === 'st' ? 0 : t === 'ot' ? 1 : t === 'dt' ? 2 : 9;
      const rows = [...groups.values()].sort((a, b) => {
        const an = a.employeeName ?? a.description ?? '';
        const bn = b.employeeName ?? b.description ?? '';
        return an.localeCompare(bn) || tierOrder(a.tier) - tierOrder(b.tier);
      });
      for (const r of rows) out.push(r);
      groups.clear();
    };
    for (const l of lines) {
      if (l.lineType === 'labor') {
        // Key on rate too: a mid-invoice promotion legitimately splits a single
        // (employee, tier) into separate priced groups so rate × hours = amount.
        const key = `${l.employeeId ?? ''}|${l.tier ?? ''}|${l.unitRate ?? ''}`;
        const ex = groups.get(key);
        if (ex) {
          ex.quantity = Number(ex.quantity) + Number(l.quantity);
          ex.amount = Number(ex.amount) + Number(l.amount);
        } else {
          // Drop the original `id` so React keys stay unique across groups.
          groups.set(key, { ...l, id: `agg-${key}`, quantity: Number(l.quantity), amount: Number(l.amount), _aggregated: true });
        }
      } else {
        flush();
        out.push(l);
      }
    }
    flush();
    return out;
  }, [lines]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="card overflow-hidden lg:col-span-2">
        <table className="w-full text-sm">
          <tbody>
            {renderLines.map((l) => (
              <tr key={l.id} className={l.lineType.includes('subtotal') || l.lineType === 'grand_total' ? 'font-semibold' : ''}>
                <td className="td">{l.description}</td>
                <td className="td">{l.quantity ? `${Number(l.quantity).toFixed(2)} hrs @ ${formatMoney(l.unitRate)}` : ''}</td>
                <td className="td text-right">{formatMoney(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card h-fit p-4">
        <div className="mb-2 text-sm font-semibold">Status</div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted">DOCX</span><Badge status={inv.docx_status ?? 'pending'}>{inv.docx_status ?? '—'}</Badge></div>
          <div className="flex justify-between"><span className="text-muted">PDF</span><Badge status={inv.pdf_status ?? 'pending'}>{inv.pdf_status ?? '—'}</Badge></div>
          <div className="flex justify-between"><span className="text-muted">Package</span><Badge status={inv.package_status ?? 'pending'}>{inv.package_status ?? '—'}</Badge></div>
          {inv.generation_error && <div className="rounded bg-red-soft p-2 text-xs text-red">{inv.generation_error}</div>}
          {inv.package_error && <div className="rounded bg-red-soft p-2 text-xs text-red">Package: {inv.package_error}</div>}
        </div>
        <div className="mt-4 mb-2 text-sm font-semibold">Totals</div>
        <Totals t={{ total_labor: inv.total_labor, total_markup: inv.total_markup, grand_total: inv.grand_total }} />
      </div>
    </div>
  );
}

function Totals({ t }: { t: any }) {
  if (!t) return null;
  return (
    <div className="space-y-1 text-sm">
      <Row label="Labor" v={t.total_labor} />
      {t.total_materials != null && <Row label="Materials" v={t.total_materials} />}
      {t.total_markup != null && <Row label="Markup" v={t.total_markup} />}
      <div className="my-1 border-t border-line" />
      <Row label="Grand Total" v={t.grand_total} bold />
    </div>
  );
}
function Row({ label, v, bold }: { label: string; v: any; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? 'font-bold text-base' : ''}`}><span className={bold ? '' : 'text-muted'}>{label}</span><span>{formatMoney(v ?? 0)}</span></div>;
}

function VoidModal({ id, reference, onClose, onVoided }: { id: string; reference: string; onClose: () => void; onVoided: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: () => api.post(`/invoices/${id}/void`, { reason }), onSuccess: () => { toast('Voided'); onVoided(); }, onError: (e: any) => toast(e.message, 'err') });
  return (
    <Modal open onClose={onClose} title="Void Invoice">
      <div className="space-y-3">
        <p className="text-sm text-muted">Type <span className="font-mono font-semibold">{reference}</span> to confirm. Entries will be unbound and re-billable.</p>
        <input className="input" placeholder="Invoice number" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <input className="input" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-danger" disabled={confirm !== reference || !reason || m.isPending} onClick={() => m.mutate()}>Void invoice</button></div>
      </div>
    </Modal>
  );
}
