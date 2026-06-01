import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Download, Ban, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@darrow/shared';
import { Skeleton, Badge, Modal, toast } from '@/components/ui';

interface MemberRow {
  invoice_id: string;
  billed_reference: string | null;
  job_code: string;
  job_description: string;
  through_date: string;
  totals: { labor: number; materials: number; equipment_rent: number; other: number; total: number };
}
interface SummaryDetail {
  id: string;
  billed_reference: string;
  status: 'draft' | 'finalized' | 'void';
  customer_id: string;
  customer_name: string;
  description: string;
  po_number: string | null;
  location_of_service: string | null;
  work_start_date: string | null;
  work_end_date: string | null;
  total_labor: string | null;
  total_materials: string | null;
  total_equipment_rent: string | null;
  total_other: string | null;
  grand_total: string | null;
  pdf_status: string | null;
  pdf_error: string | null;
  members: MemberRow[];
}

export function InvoiceSummaryDetailPage({ id }: { id: string }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['summary', id],
    queryFn: () => api.get<SummaryDetail>(`/invoice-summaries/${id}`),
    refetchInterval: (q) => (q.state.data?.pdf_status === 'pending' ? 3000 : false),
  });
  const [voiding, setVoiding] = useState(false);

  const finalize = useMutation({
    mutationFn: () => api.post(`/invoice-summaries/${id}/finalize`),
    onSuccess: () => { toast('Summary finalized'); qc.invalidateQueries({ queryKey: ['summary', id] }); qc.invalidateQueries({ queryKey: ['summaries'] }); },
    onError: (e: any) => toast(e.message, 'err'),
  });
  const regen = useMutation({
    mutationFn: () => api.post(`/invoice-summaries/${id}/regenerate`),
    onSuccess: () => { toast('Regenerating'); qc.invalidateQueries({ queryKey: ['summary', id] }); },
  });

  if (isLoading || !data) return <Skeleton rows={8} />;
  const s = data;
  const isDraft = s.status === 'draft';
  const showOther = (s.members ?? []).some((m) => m.totals.other > 0);

  return (
    <div>
      <button className="btn-ghost mb-4" onClick={() => nav({ to: '/invoices' })}><ArrowLeft size={16} /> Invoices</button>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-mono">{s.billed_reference}</h1>
            <Badge status={s.status}>{s.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">Summary invoice · {s.customer_name} · {s.members.length} child invoice{s.members.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex gap-2">
          {isDraft && <button className="btn-primary" onClick={() => finalize.mutate()} disabled={finalize.isPending || s.members.length === 0}>Finalize</button>}
          {s.status === 'finalized' && (
            <>
              <a className={`btn-primary ${s.pdf_status !== 'ready' ? 'pointer-events-none opacity-50' : ''}`} href={`/api/invoice-summaries/${id}/pdf`} title={s.pdf_status === 'ready' ? 'Download PDF' : `PDF ${s.pdf_status ?? 'pending'}`}>
                <Download size={15} /> PDF
              </a>
              <button className="btn-ghost" onClick={() => regen.mutate()}><RefreshCw size={15} /></button>
              <button className="btn-danger" onClick={() => setVoiding(true)}><Ban size={15} /> Void</button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card md:col-span-2 overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Job</th>
                <th className="th">Description</th>
                <th className="th">Through</th>
                <th className="th text-right">Labor</th>
                <th className="th text-right">Materials</th>
                <th className="th text-right">Equipment Rent</th>
                {showOther && <th className="th text-right">Other</th>}
                <th className="th text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {s.members.map((m) => (
                <tr key={m.invoice_id}>
                  <td className="td font-mono font-medium">{m.billed_reference ?? m.job_code}</td>
                  <td className="td">{m.job_description}</td>
                  <td className="td">{m.through_date}</td>
                  <td className="td text-right">{formatMoney(m.totals.labor)}</td>
                  <td className="td text-right">{formatMoney(m.totals.materials)}</td>
                  <td className="td text-right">{formatMoney(m.totals.equipment_rent)}</td>
                  {showOther && <td className="td text-right">{formatMoney(m.totals.other)}</td>}
                  <td className="td text-right font-semibold">{formatMoney(m.totals.total)}</td>
                </tr>
              ))}
              {s.status === 'finalized' && (
                <tr className="border-t-2 border-line font-semibold">
                  <td className="td" colSpan={3}>Total Invoice</td>
                  <td className="td text-right">{formatMoney(s.total_labor ?? 0)}</td>
                  <td className="td text-right">{formatMoney(s.total_materials ?? 0)}</td>
                  <td className="td text-right">{formatMoney(s.total_equipment_rent ?? 0)}</td>
                  {showOther && <td className="td text-right">{formatMoney(s.total_other ?? 0)}</td>}
                  <td className="td text-right">{formatMoney(s.grand_total ?? 0)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="space-y-3">
          <div className="card p-4">
            <div className="mb-2 text-sm font-semibold">Details</div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted">P.O. number</dt><dd>{s.po_number || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Location</dt><dd className="text-right">{s.location_of_service || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Start</dt><dd>{s.work_start_date ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">End</dt><dd>{s.work_end_date ?? '—'}</dd></div>
            </dl>
            {s.description && <p className="mt-2 whitespace-pre-wrap text-xs text-muted">{s.description}</p>}
          </div>
          <div className="card p-4">
            <div className="mb-2 text-sm font-semibold">Status</div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted">Summary</span><Badge status={s.status}>{s.status}</Badge></div>
              {s.status === 'finalized' && <div className="flex justify-between"><span className="text-muted">PDF</span><Badge status={s.pdf_status ?? 'pending'}>{s.pdf_status ?? '—'}</Badge></div>}
              {s.pdf_error && <div className="rounded bg-red-soft p-2 text-xs text-red">{s.pdf_error}</div>}
            </div>
          </div>
        </div>
      </div>

      {voiding && <VoidModal id={id} billedRef={s.billed_reference} onClose={() => setVoiding(false)} onVoided={() => { setVoiding(false); qc.invalidateQueries({ queryKey: ['summary', id] }); qc.invalidateQueries({ queryKey: ['summaries'] }); }} />}
    </div>
  );
}

function VoidModal({ id, billedRef, onClose, onVoided }: { id: string; billedRef: string; onClose: () => void; onVoided: () => void }) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/invoice-summaries/${id}/void`, { reason }),
    onSuccess: () => { toast('Voided'); onVoided(); },
    onError: (e: any) => toast(e.message, 'err'),
  });
  return (
    <Modal open onClose={onClose} title={`Void summary ${billedRef}`}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Voiding releases the child invoices so they can be summarized again. Type the summary number to confirm.</p>
        <input className="input" placeholder={billedRef} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <textarea className="input" rows={3} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-danger" onClick={() => m.mutate()} disabled={confirm !== billedRef || !reason || m.isPending}>Void</button>
        </div>
      </div>
    </Modal>
  );
}
