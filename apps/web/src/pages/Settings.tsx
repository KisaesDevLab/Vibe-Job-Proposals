import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '@darrow/shared';
import { PageHeader } from '@/components/Layout';
import { Skeleton, toast } from '@/components/ui';
import { SearchSelect } from '@/components/SearchSelect';

export function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<any>('/settings') });
  const [tab, setTab] = useState<'company' | 'branding' | 'markups' | 'tunnel' | 'backup'>('company');
  if (isLoading) return <div><PageHeader title="Settings" /><Skeleton /></div>;
  const tabLabel = (t: string) => t === 'tunnel' ? 'Remote access' : t === 'backup' ? 'Backup & restore' : t;
  return (
    <div>
      <PageHeader title="Settings" subtitle="Company, branding, markups, remote access & backup" />
      <div className="mb-5 flex gap-2 border-b border-line">
        {(['company', 'branding', 'markups', 'tunnel', 'backup'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm font-medium capitalize ${tab === t ? 'border-b-2 border-copper text-copper' : 'text-muted'}`}>{tabLabel(t)}</button>
        ))}
      </div>
      {tab === 'company' && <Company data={data} onSaved={() => qc.invalidateQueries({ queryKey: ['settings'] })} />}
      {tab === 'branding' && <Branding data={data} onSaved={() => qc.invalidateQueries({ queryKey: ['settings'] })} />}
      {tab === 'markups' && <Markups data={data} onSaved={() => qc.invalidateQueries({ queryKey: ['settings'] })} />}
      {tab === 'tunnel' && <Tunnel />}
      {tab === 'backup' && <BackupRestore />}
    </div>
  );
}

function Company({ data, onSaved }: { data: any; onSaved: () => void }) {
  const [f, setF] = useState<any>({});
  useEffect(() => setF({ company_name: data.companyName, address_line1: data.addressLine1, address_line2: data.addressLine2, city: data.city, state: data.state, zip: data.zip, phone: data.phone, email: data.email }), [data]);
  const m = useMutation({ mutationFn: () => api.put('/settings', f), onSuccess: () => { toast('Saved'); onSaved(); }, onError: (e: any) => toast(e.message, 'err') });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="card max-w-xl space-y-3 p-5">
      <div><label className="label">Company name</label><input className="input" value={f.company_name ?? ''} onChange={set('company_name')} /></div>
      <div><label className="label">Address line 1</label><input className="input" value={f.address_line1 ?? ''} onChange={set('address_line1')} /></div>
      <div><label className="label">Address line 2</label><input className="input" value={f.address_line2 ?? ''} onChange={set('address_line2')} /></div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="label">City</label><input className="input" value={f.city ?? ''} onChange={set('city')} /></div>
        <div><label className="label">State</label><input className="input" value={f.state ?? ''} onChange={set('state')} /></div>
        <div><label className="label">Zip</label><input className="input" value={f.zip ?? ''} onChange={set('zip')} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Phone</label><input className="input" value={f.phone ?? ''} onChange={set('phone')} /></div>
        <div><label className="label">Email</label><input className="input" value={f.email ?? ''} onChange={set('email')} /></div>
      </div>
      <button className="btn-primary" onClick={() => m.mutate()} disabled={m.isPending}>Save</button>
    </div>
  );
}

function Branding({ data, onSaved }: { data: any; onSaved: () => void }) {
  const [showPh, setShowPh] = useState(false);
  const { data: ph } = useQuery({ queryKey: ['placeholders'], queryFn: () => api.get<any>('/settings/placeholders'), enabled: showPh });
  async function up(kind: 'logo' | 'template', file: File) {
    try { await api.upload(`/settings/${kind}`, file); toast(`${kind} uploaded`); onSaved(); } catch (e: any) { toast(e.message, 'err'); }
  }
  return (
    <div className="space-y-4">
      <div className="card max-w-xl space-y-4 p-5">
        <div>
          <label className="label">Logo (PNG/JPG, max 2MB)</label>
          {data.logoPath && <img src={`/api/settings/logo?t=${Date.now()}`} alt="logo" className="mb-2 h-16" />}
          <input type="file" accept="image/png,image/jpeg" onChange={(e) => e.target.files?.[0] && up('logo', e.target.files[0])} />
        </div>
        <div>
          <label className="label">Invoice template (.docx, max 5MB)</label>
          <div className="mb-2 text-sm text-muted">
            {data.templateDocxPath ? 'Template uploaded' : 'No template'}
            {data.templateDocxPath && <> · <a className="text-copper" href="/api/settings/template/download">download current</a></>}
            {' · '}<a className="text-copper" href="/api/settings/example-template">download starter template</a>
            {' · '}<button className="text-copper" onClick={() => setShowPh((v) => !v)}>view placeholders</button>
          </div>
          <input type="file" accept=".docx" onChange={(e) => e.target.files?.[0] && up('template', e.target.files[0])} />
          {showPh && ph && <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-paper p-3 text-xs">{ph.markdown}</pre>}
        </div>
      </div>
      <SmtpSection data={data} onSaved={onSaved} />
    </div>
  );
}

function SmtpSection({ data, onSaved }: { data: any; onSaved: () => void }) {
  const [f, setF] = useState({ smtp_host: '', smtp_port: '587', smtp_user: '', smtp_password: '', smtp_from_address: '', smtp_from_name: '', smtp_enabled: false });
  const [testTo, setTestTo] = useState('');
  useEffect(() => setF((p) => ({ ...p, smtp_host: data.smtpHost ?? '', smtp_port: String(data.smtpPort ?? 587), smtp_user: data.smtpUser ?? '', smtp_from_address: data.smtpFromAddress ?? '', smtp_from_name: data.smtpFromName ?? '', smtp_enabled: !!data.smtpEnabled })), [data]);
  const save = useMutation({ mutationFn: () => api.put('/settings/smtp', { ...f, smtp_port: Number(f.smtp_port), smtp_password: f.smtp_password || undefined }), onSuccess: () => { toast('SMTP saved'); onSaved(); }, onError: (e: any) => toast(e.message, 'err') });
  const test = useMutation({ mutationFn: () => api.post('/settings/smtp/test', { to: testTo || undefined }), onSuccess: () => toast('SMTP verified'), onError: (e: any) => toast(e.message, 'err') });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="card max-w-xl space-y-3 p-5">
      <div className="font-semibold">Email (SMTP) — optional</div>
      <p className="text-xs text-muted">Download is the primary delivery path; email is optional. Password is encrypted at rest.{data.smtp_password_set ? ' A password is currently stored.' : ''}</p>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Host</label><input className="input" value={f.smtp_host} onChange={set('smtp_host')} /></div>
        <div><label className="label">Port</label><input className="input" value={f.smtp_port} onChange={set('smtp_port')} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">User</label><input className="input" value={f.smtp_user} onChange={set('smtp_user')} /></div>
        <div><label className="label">Password</label><input className="input" type="password" placeholder={data.smtp_password_set ? '••••••• (unchanged)' : ''} value={f.smtp_password} onChange={set('smtp_password')} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">From address</label><input className="input" value={f.smtp_from_address} onChange={set('smtp_from_address')} /></div>
        <div><label className="label">From name</label><input className="input" value={f.smtp_from_name} onChange={set('smtp_from_name')} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.smtp_enabled} onChange={(e) => setF({ ...f, smtp_enabled: e.target.checked })} /> Enable email delivery</label>
      <div className="flex items-center gap-2">
        <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>Save SMTP</button>
        <input className="input w-48" placeholder="test recipient" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        <button className="btn-ghost" onClick={() => test.mutate()} disabled={test.isPending}>Test connect</button>
      </div>
    </div>
  );
}

function Markups({ data, onSaved }: { data: any; onSaved: () => void }) {
  const init = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, String((data.markups.find((m: any) => m.category === c)?.percent ?? 0) * 100)]));
  const [map, setMap] = useState<Record<string, string>>(init);
  const m = useMutation({ mutationFn: () => api.put('/settings/markups', EXPENSE_CATEGORIES.map((c) => ({ category: c, percent: Number(map[c]) / 100 }))), onSuccess: () => { toast('Saved'); onSaved(); }, onError: (e: any) => toast(e.message ?? String(e), 'err') });
  return (
    <div className="card max-w-md space-y-2 p-5">
      {EXPENSE_CATEGORIES.map((c) => (
        <div key={c} className="flex items-center gap-3">
          <div className="w-40 text-sm">{EXPENSE_CATEGORY_LABELS[c]}</div>
          <input className="input w-28" value={map[c]} onChange={(e) => setMap({ ...map, [c]: e.target.value })} />
          <span className="text-sm text-muted">%</span>
        </div>
      ))}
      <button className="btn-primary mt-3" onClick={() => m.mutate()} disabled={m.isPending}>Save defaults</button>
    </div>
  );
}

interface TunnelStatus {
  enabled: boolean;
  status: string;
  last_error: string | null;
  last_provisioned_at: string | null;
  fqdn: string | null;
  subdomain: string | null;
  zone_name: string | null;
  tunnel_name: string | null;
  api_token_set: boolean;
  account_id: string | null;
  zone_id: string | null;
  tunnel_id: string | null;
}
interface CfAccount { id: string; name: string; }
interface CfZone { id: string; name: string; account: { id: string; name: string }; }

function Tunnel() {
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery({ queryKey: ['tunnel'], queryFn: () => api.get<TunnelStatus>('/settings/tunnel') });
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState<{ accounts: CfAccount[]; zones: CfZone[] } | null>(null);
  const [accountId, setAccountId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [tunnelName, setTunnelName] = useState('');
  const [subdomain, setSubdomain] = useState('');

  // Seed form from prior state when available.
  useEffect(() => {
    if (status) {
      if (status.account_id && !accountId) setAccountId(status.account_id);
      if (status.zone_id && !zoneId) setZoneId(status.zone_id);
      if (status.tunnel_name && !tunnelName) setTunnelName(status.tunnel_name);
      if (status.subdomain && !subdomain) setSubdomain(status.subdomain);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.tunnel_id]);

  const verify = useMutation({
    mutationFn: () => api.post<{ accounts: CfAccount[]; zones: CfZone[] }>('/settings/tunnel/verify', { api_token: token }),
    onSuccess: (data) => {
      setVerified(data);
      toast(`Token OK — ${data.accounts.length} account(s), ${data.zones.length} zone(s)`);
      if (data.accounts.length === 1) setAccountId(data.accounts[0].id);
      if (data.zones.length === 1) { setZoneId(data.zones[0].id); }
    },
    onError: (e: any) => toast(e.message, 'err'),
  });

  const provision = useMutation({
    mutationFn: () => {
      const zone = verified?.zones.find((z) => z.id === zoneId);
      return api.post<{ fqdn: string; tunnel_id: string; status: string }>('/settings/tunnel/provision', {
        api_token: token,
        account_id: accountId,
        zone_id: zoneId,
        zone_name: zone?.name ?? '',
        tunnel_name: tunnelName.trim(),
        subdomain: subdomain.trim().toLowerCase(),
      });
    },
    onSuccess: (data) => {
      toast(`Tunnel up at https://${data.fqdn}`);
      setToken('');
      setVerified(null);
      qc.invalidateQueries({ queryKey: ['tunnel'] });
    },
    onError: (e: any) => toast(e.message, 'err'),
  });

  const disable = useMutation({
    mutationFn: () => api.post('/settings/tunnel/disable'),
    onSuccess: () => { toast('Tunnel disabled'); qc.invalidateQueries({ queryKey: ['tunnel'] }); },
    onError: (e: any) => toast(e.message, 'err'),
  });

  if (isLoading) return <Skeleton rows={5} />;
  const zonesForAccount = verified?.zones.filter((z) => !accountId || z.account.id === accountId) ?? [];

  return (
    <div className="max-w-2xl space-y-4">
      <div className="card p-5">
        <div className="mb-2 text-sm font-semibold">Status</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted">State:</span> <span className="font-medium">{status?.status ?? '—'}</span></div>
          <div><span className="text-muted">Public URL:</span> {status?.fqdn ? <a href={`https://${status.fqdn}`} target="_blank" rel="noreferrer" className="text-copper underline">{status.fqdn}</a> : <span className="text-muted">not configured</span>}</div>
          <div><span className="text-muted">Last provisioned:</span> {status?.last_provisioned_at ?? '—'}</div>
          <div><span className="text-muted">API token saved:</span> {status?.api_token_set ? 'yes' : 'no'}</div>
        </div>
        {status?.last_error && (
          <div className="mt-3 rounded bg-red-soft p-2 text-xs text-red">Last error: {status.last_error}</div>
        )}
      </div>

      <div className="card space-y-3 p-5">
        <div className="text-sm font-semibold">Cloudflare credentials</div>
        <p className="text-xs text-muted">
          Create a user API token at <a className="text-copper underline" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">dash.cloudflare.com/profile/api-tokens</a> with these permissions:
          <em> Account → Cloudflare Tunnel: Edit</em>, <em> Zone → DNS: Edit</em>, <em> Account → Account Settings: Read</em>.
        </p>
        <div>
          <label className="label">API token</label>
          <input className="input" type="password" placeholder="leave blank to keep saved token" value={token} onChange={(e) => setToken(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => verify.mutate()} disabled={!token || verify.isPending}>Verify token</button>
          {status?.enabled && (
            <button className="btn-danger" onClick={() => { if (confirm('Disable the tunnel and remove the CNAME + tunnel from Cloudflare?')) disable.mutate(); }} disabled={disable.isPending}>Disable tunnel</button>
          )}
        </div>
      </div>

      {verified && (
        <div className="card space-y-3 p-5">
          <div className="text-sm font-semibold">Hostname &amp; tunnel</div>
          <div>
            <label className="label">Cloudflare account</label>
            <SearchSelect
              value={accountId}
              onChange={(v) => { setAccountId(v); setZoneId(''); }}
              options={verified.accounts.map((a) => ({ value: a.id, label: a.name, sublabel: a.id }))}
              placeholder="Select account…"
            />
          </div>
          <div>
            <label className="label">Zone (domain)</label>
            <SearchSelect
              value={zoneId}
              onChange={setZoneId}
              options={zonesForAccount.map((z) => ({ value: z.id, label: z.name, sublabel: z.account.name }))}
              placeholder="Select zone…"
              disabled={!accountId}
            />
            <p className="mt-1 text-xs text-muted">Must be a zone you own in this Cloudflare account.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Subdomain</label>
              <input className="input" placeholder="e.g. darrow" value={subdomain} onChange={(e) => setSubdomain(e.target.value.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase())} />
              <p className="mt-1 text-xs text-muted">Public URL will be <span className="font-mono">{(subdomain || 'subdomain')}.{(verified.zones.find((z) => z.id === zoneId)?.name ?? 'your-zone')}</span></p>
            </div>
            <div>
              <label className="label">Tunnel name</label>
              <input className="input" placeholder="e.g. darrow-time-invoicing" value={tunnelName} onChange={(e) => setTunnelName(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))} />
              <p className="mt-1 text-xs text-muted">Cloudflare label for the tunnel; existing tunnel with this name is reused.</p>
            </div>
          </div>
          <button
            className="btn-primary"
            onClick={() => provision.mutate()}
            disabled={!accountId || !zoneId || !tunnelName || !subdomain || provision.isPending}
          >
            {provision.isPending ? 'Provisioning…' : status?.enabled ? 'Re-provision tunnel' : 'Provision tunnel'}
          </button>
        </div>
      )}
    </div>
  );
}

interface BackupRow { filename: string; size_bytes: number; created_at: string; }

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function BackupRestore() {
  const qc = useQueryClient();
  const { data: backups, isLoading } = useQuery({ queryKey: ['backups'], queryFn: () => api.get<BackupRow[]>('/settings/backups') });
  const createMut = useMutation({
    mutationFn: () => api.post<BackupRow>('/settings/backups'),
    onSuccess: (r) => { toast(`Created ${r.filename}`); qc.invalidateQueries({ queryKey: ['backups'] }); },
    onError: (e: any) => toast(e.message ?? String(e), 'err'),
  });
  const deleteMut = useMutation({
    mutationFn: (filename: string) => api.del(`/settings/backups/${encodeURIComponent(filename)}`),
    onSuccess: () => { toast('Deleted'); qc.invalidateQueries({ queryKey: ['backups'] }); },
    onError: (e: any) => toast(e.message ?? String(e), 'err'),
  });

  const [restoring, setRestoring] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const restoreMut = useMutation({
    mutationFn: async () => {
      if (!restoreFile) throw new Error('Pick a backup file first');
      const fd = new FormData();
      fd.append('file', restoreFile);
      fd.append('confirm', confirmText);
      // Direct fetch — api.upload only attaches the file field, no extra body.
      const res = await fetch('/api/settings/restore', { method: 'POST', headers: { 'X-Requested-With': 'darrow' }, body: fd, credentials: 'same-origin' });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json?.error?.message ?? 'Restore failed');
      return json.data;
    },
    onSuccess: () => {
      toast('Restored — reloading');
      setRestoring(false);
      setRestoreFile(null);
      setConfirmText('');
      setTimeout(() => window.location.assign('/login'), 800);
    },
    onError: (e: any) => toast(e.message ?? String(e), 'err'),
  });

  return (
    <div className="space-y-6">
      <div className="card max-w-3xl space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Backups</h3>
            <p className="text-xs text-muted">Each backup is a single .tar.gz containing a pg_dump of the database and a snapshot of the storage tree (PDFs, attachments, logo, template). Backups live under <code className="rounded bg-paper px-1">storage/backups/</code>.</p>
          </div>
          <button className="btn-primary shrink-0" onClick={() => createMut.mutate()} disabled={createMut.isPending}>
            {createMut.isPending ? 'Backing up…' : 'Create backup now'}
          </button>
        </div>
        {isLoading ? <Skeleton rows={3} /> : (backups ?? []).length === 0 ? (
          <p className="text-sm text-muted">No backups yet. Click "Create backup now" to make one.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-paper/60">
                  <th className="th">Filename</th>
                  <th className="th text-right">Size</th>
                  <th className="th">Created</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {backups!.map((b) => (
                  <tr key={b.filename}>
                    <td className="td font-mono text-xs">{b.filename}</td>
                    <td className="td text-right">{fmtBytes(b.size_bytes)}</td>
                    <td className="td">{new Date(b.created_at).toLocaleString()}</td>
                    <td className="td text-right">
                      <a className="btn-ghost" href={`/api/settings/backups/${encodeURIComponent(b.filename)}/download`}>Download</a>
                      <button
                        className="btn-ghost ml-1 text-red"
                        onClick={() => {
                          if (confirm(`Delete ${b.filename}?`)) deleteMut.mutate(b.filename);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card max-w-3xl space-y-3 border-red/40 p-5">
        <h3 className="font-semibold text-red">Restore from backup</h3>
        <p className="text-xs text-muted">
          Restoring <strong>replaces every row in the database</strong> and overwrites the storage tree
          (except the backups directory) with the contents of the archive. You will be logged out.
        </p>
        {!restoring ? (
          <button className="btn-danger" onClick={() => setRestoring(true)}>Restore from file…</button>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label">Backup archive (.tar.gz)</label>
              <input
                type="file"
                accept=".gz,.tar.gz,application/gzip"
                onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
              {restoreFile && <p className="mt-1 text-xs text-muted">{restoreFile.name} · {fmtBytes(restoreFile.size)}</p>}
            </div>
            <div>
              <label className="label">Type <code className="rounded bg-paper px-1">REPLACE ALL DATA</code> to confirm</label>
              <input
                className="input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="REPLACE ALL DATA"
              />
            </div>
            <div className="flex gap-2">
              <button
                className="btn-danger"
                onClick={() => restoreMut.mutate()}
                disabled={!restoreFile || confirmText !== 'REPLACE ALL DATA' || restoreMut.isPending}
              >
                {restoreMut.isPending ? 'Restoring…' : 'Restore now'}
              </button>
              <button className="btn-ghost" onClick={() => { setRestoring(false); setRestoreFile(null); setConfirmText(''); }} disabled={restoreMut.isPending}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
