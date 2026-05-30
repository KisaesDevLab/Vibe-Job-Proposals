import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Zap, Upload, CheckCircle, FileText, X } from 'lucide-react';
import { Spinner, toast } from '@/components/ui';

// No-login bill upload page, reached via /upload?k=<token>. Token-gated; submissions
// land in the admin's processing inbox with the optional job code + notes.
export function PublicUploadPage() {
  const token = new URLSearchParams(window.location.search).get('k') ?? '';
  const { data: check, isLoading } = useQuery({
    queryKey: ['public-check', token],
    queryFn: async () => {
      const r = await fetch(`/api/public/upload/check?k=${encodeURIComponent(token)}`);
      return r.ok;
    },
    retry: false,
  });

  const [files, setFiles] = useState<File[]>([]);
  const [jobCode, setJobCode] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | File[]) {
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }

  async function submit() {
    if (!files.length) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      if (jobCode.trim()) fd.append('job_code', jobCode.trim());
      if (notes.trim()) fd.append('notes', notes.trim());
      const res = await fetch(`/api/public/upload?k=${encodeURIComponent(token)}`, { method: 'POST', body: fd });
      const json = await res.json();
      if (json.ok === false) throw new Error(json.error.message);
      setDone(json.data.created);
      setFiles([]);
      setJobCode('');
      setNotes('');
      if (json.data.rejected?.length) toast(`${json.data.rejected.length} file(s) rejected: ${json.data.rejected[0].reason}`, 'err');
    } catch (e: any) {
      toast(e.message ?? 'Upload failed', 'err');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-full bg-paper py-10">
      <div className="mx-auto max-w-xl px-4">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-copper text-white"><Zap size={24} /></div>
          <div>
            <div className="text-lg font-bold">Darrow Electric</div>
            <div className="text-xs text-muted">Bill / receipt upload</div>
          </div>
        </div>

        {isLoading ? (
          <div className="card grid place-items-center p-12"><Spinner /></div>
        ) : !check ? (
          <div className="card p-8 text-center">
            <div className="font-semibold text-red">This upload link is invalid or has expired.</div>
            <p className="mt-1 text-sm text-muted">Please ask the office for a current link.</p>
          </div>
        ) : done !== null ? (
          <div className="card p-8 text-center">
            <CheckCircle className="mx-auto mb-2 text-green" size={36} />
            <div className="font-semibold">Thank you — {done} file{done === 1 ? '' : 's'} received.</div>
            <p className="mt-1 text-sm text-muted">The office will process {done === 1 ? 'it' : 'them'} shortly.</p>
            <button className="btn-primary mt-4" onClick={() => setDone(null)}>Upload more</button>
          </div>
        ) : (
          <div className="card space-y-4 p-6">
            <p className="text-sm text-muted">Drop photos or PDFs of your bills/receipts below. Job code and notes are optional but help us file them correctly.</p>

            <div
              className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-paper p-8 text-center text-sm text-muted"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
              onPaste={(e) => { if (e.clipboardData.files.length) addFiles(e.clipboardData.files); }}
            >
              <Upload size={22} />
              <span>Drag files here, paste a photo, or</span>
              <button className="btn-ghost" onClick={() => fileRef.current?.click()}>choose files</button>
              <input ref={fileRef} type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic" onChange={(e) => e.target.files && addFiles(e.target.files)} />
            </div>

            {files.length > 0 && (
              <div className="space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-line bg-card px-3 py-2 text-sm">
                    <span className="flex items-center gap-2 truncate"><FileText size={15} /> {f.name} <span className="text-muted">({Math.round(f.size / 1024)} KB)</span></span>
                    <button className="text-muted hover:text-red" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}><X size={15} /></button>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="label">Job code <span className="font-normal normal-case text-muted">(optional)</span></label>
              <input className="input font-mono" placeholder="e.g. D26NB048" value={jobCode} onChange={(e) => setJobCode(e.target.value)} />
            </div>
            <div>
              <label className="label">Notes <span className="font-normal normal-case text-muted">(optional)</span></label>
              <textarea className="input h-24" placeholder="Anything the office should know about these bills" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <button className="btn-primary w-full justify-center" onClick={submit} disabled={!files.length || submitting}>
              {submitting ? <Spinner /> : `Submit ${files.length || ''} ${files.length === 1 ? 'file' : 'files'}`.trim()}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
