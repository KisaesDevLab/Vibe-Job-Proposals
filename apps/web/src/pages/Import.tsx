import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Upload as UploadIcon, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { Skeleton, toast } from '@/components/ui';
import { SearchSelect } from '@/components/SearchSelect';

interface ImporterType { value: string; label: string; columns: string[]; }
interface PreviewRow extends Record<string, unknown> { _row: number; _errors?: string[]; }
interface PreviewResult { type: string; sheet_name: string; total_rows: number; rows: PreviewRow[]; errors: { row: number; message: string }[]; }

// Pretty column order per type so the preview table is scannable. Falls back
// to the natural order from the parsed row.
const COL_ORDER: Record<string, string[]> = {
  expenses: ['work_date', 'vendor', 'reference', 'category', 'job_code', 'amount', 'description'],
  customers: ['name', 'bill_to_address1', 'bill_to_city', 'bill_to_state', 'bill_to_zip', 'contact_name', 'contact_email', 'contact_phone'],
};

export function ImportPage() {
  const { data: types } = useQuery({ queryKey: ['import-types'], queryFn: () => api.get<ImporterType[]>('/import/types') });
  const [type, setType] = useState<string>('expenses');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');
      const fd = new FormData();
      fd.append('file', file);
      return api.upload<PreviewResult>(`/import/preview?type=${type}`, file);
    },
    onSuccess: (data) => { setPreview(data); },
    onError: (e: any) => toast(e.message, 'err'),
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error('Generate a preview first');
      const cleanRows = preview.rows.filter((r) => !r._errors || r._errors.length === 0);
      return api.post<{ inserted: number; updated: number; skipped: number }>(`/import/commit?type=${type}`, { rows: cleanRows });
    },
    onSuccess: (r) => {
      toast(`Imported ${r.inserted} new, ${r.updated} updated, ${r.skipped} skipped`);
      setPreview(null);
      setFile(null);
    },
    onError: (e: any) => toast(e.message, 'err'),
  });

  const selected = types?.find((t) => t.value === type);
  const cleanCount = useMemo(() => preview ? preview.rows.filter((r) => !r._errors || r._errors.length === 0).length : 0, [preview]);
  const errCount = useMemo(() => preview ? preview.rows.filter((r) => r._errors && r._errors.length > 0).length : 0, [preview]);

  // Column list for the preview table — prefer the type's canonical order,
  // fall back to keys actually present in the first row.
  const cols = useMemo(() => {
    if (!preview || preview.rows.length === 0) return [];
    const canonical = COL_ORDER[preview.type] ?? [];
    const present = new Set<string>();
    for (const r of preview.rows) for (const k of Object.keys(r)) if (!k.startsWith('_')) present.add(k);
    const ordered = canonical.filter((c) => present.has(c));
    for (const k of present) if (!ordered.includes(k)) ordered.push(k);
    return ordered;
  }, [preview]);

  if (!types) return <div><PageHeader title="Import" /><Skeleton /></div>;

  return (
    <div>
      <PageHeader title="Import from Excel" subtitle="Upload an .xlsx, pick the data type, preview, then commit" />
      <div className="card mb-4 max-w-3xl space-y-3 p-5">
        <div>
          <label className="label">Data type</label>
          <SearchSelect
            value={type}
            onChange={(v) => { setType(v); setPreview(null); }}
            options={types.map((t) => ({ value: t.value, label: t.label }))}
            placeholder="Select…"
          />
        </div>
        {selected && (
          <p className="text-xs text-muted">
            Expected columns (case-insensitive, common synonyms accepted):{' '}
            <span className="font-mono">{selected.columns.join(' | ')}</span>
          </p>
        )}
        <div>
          <label className="label">Workbook (.xlsx)</label>
          <div
            className="flex items-center gap-3 rounded-xl border-2 border-dashed border-line bg-paper/40 p-4 text-sm text-muted"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) { setFile(f); setPreview(null); } }}
          >
            <UploadIcon size={18} />
            <span>{file ? file.name : 'Drag here or'}</span>
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>{file ? 'change file' : 'choose file'}</button>
            <input ref={fileRef} type="file" className="hidden" accept=".xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setPreview(null); } }} />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button className="btn-primary" onClick={() => previewMutation.mutate()} disabled={!file || previewMutation.isPending}>
            {previewMutation.isPending ? 'Parsing…' : 'Preview'}
          </button>
          {preview && (
            <button className="btn-primary" onClick={() => commitMutation.mutate()} disabled={cleanCount === 0 || commitMutation.isPending}>
              {commitMutation.isPending ? 'Importing…' : `Import ${cleanCount} row${cleanCount === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>

      {preview && (
        <div>
          <div className="mb-2 flex items-center gap-3 text-sm">
            <span className="text-muted">Sheet: <span className="font-mono">{preview.sheet_name}</span></span>
            <span><CheckCircle2 className="mr-1 inline text-finalized" size={14} />{cleanCount} valid</span>
            {errCount > 0 && <span className="text-red"><AlertTriangle className="mr-1 inline" size={14} />{errCount} with errors</span>}
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Row</th>
                  {cols.map((c) => <th key={c} className="th">{c}</th>)}
                  <th className="th">Errors</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r._row} className={r._errors && r._errors.length > 0 ? 'bg-red-soft/50' : ''}>
                    <td className="td text-muted">{r._row}</td>
                    {cols.map((c) => <td key={c} className="td">{r[c] == null ? '' : String(r[c])}</td>)}
                    <td className="td text-xs text-red">{r._errors?.join('; ') ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
