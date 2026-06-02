// Users management — admin can list, create, rename, change role,
// activate/deactivate, reset password, or delete other operators.
//
// Server-side rails prevent locking out the last admin; the UI surfaces
// those errors via the toast. Generated passwords are shown exactly once
// in a modal — operator must record them.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, KeyRound, Trash2, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { Modal, Skeleton, Empty, Badge, toast } from '@/components/ui';
import { SearchSelect } from '@/components/SearchSelect';

interface User {
  id: string;
  username: string;
  role: 'admin' | 'owner';
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export function UsersPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') });
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ id: string; username: string }>('/auth/me') });
  const [creating, setCreating] = useState(false);
  const [credential, setCredential] = useState<{ title: string; username?: string; password: string } | null>(null);

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Add, deactivate, or reset passwords for other operators"
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New user</button>}
      />
      {isLoading ? <Skeleton /> : !data?.length ? <Empty title="No users yet" /> : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Username</th>
                <th className="th">Role</th>
                <th className="th">Status</th>
                <th className="th">Created</th>
                <th className="th">Last login</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <UserRow key={u.id} u={u} isSelf={u.id === me?.id} onCredential={setCredential} onChanged={() => qc.invalidateQueries({ queryKey: ['users'] })} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <NewUserModal
          onClose={() => setCreating(false)}
          onCreated={(c) => { setCreating(false); setCredential(c); qc.invalidateQueries({ queryKey: ['users'] }); }}
        />
      )}
      {credential && <CredentialModal {...credential} onClose={() => setCredential(null)} />}
    </div>
  );
}

function UserRow({ u, isSelf, onCredential, onChanged }: { u: User; isSelf: boolean; onCredential: (c: { title: string; username?: string; password: string }) => void; onChanged: () => void }) {
  const toggleActive = useMutation({
    mutationFn: () => api.put(`/users/${u.id}`, { active: !u.active }),
    onSuccess: () => { toast(`${u.username} ${u.active ? 'deactivated' : 'activated'}`); onChanged(); },
    onError: (e: any) => toast(e.message ?? String(e), 'err'),
  });
  const reset = useMutation({
    mutationFn: () => api.post<{ password: string }>(`/users/${u.id}/reset-password`),
    onSuccess: (r) => {
      onCredential({ title: `Password reset for ${u.username}`, username: u.username, password: r.password });
    },
    onError: (e: any) => toast(e.message ?? String(e), 'err'),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/users/${u.id}`),
    onSuccess: () => { toast(`Deleted ${u.username}`); onChanged(); },
    onError: (e: any) => toast(e.message ?? String(e), 'err'),
  });
  return (
    <tr className={u.active ? '' : 'opacity-60'}>
      <td className="td font-medium">{u.username} {isSelf && <span className="text-xs text-muted">(you)</span>}</td>
      <td className="td"><Badge>{u.role}</Badge></td>
      <td className="td">
        {u.active ? <Badge status="finalized">active</Badge> : <Badge status="void">inactive</Badge>}
      </td>
      <td className="td text-xs text-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
      <td className="td text-xs text-muted">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</td>
      <td className="td text-right">
        <button className="btn-ghost text-xs" onClick={() => reset.mutate()} disabled={reset.isPending}><KeyRound size={13} /> Reset password</button>
        <button
          className="btn-ghost ml-1 text-xs"
          onClick={() => toggleActive.mutate()}
          disabled={toggleActive.isPending || isSelf}
          title={isSelf ? 'You can\'t deactivate yourself' : ''}
        >
          {u.active ? 'Deactivate' : 'Activate'}
        </button>
        <button
          className="btn-ghost ml-1 text-xs text-red"
          onClick={() => {
            if (confirm(`Delete user "${u.username}"? They will be signed out and removed permanently.`)) del.mutate();
          }}
          disabled={del.isPending || isSelf}
          title={isSelf ? 'You can\'t delete yourself' : ''}
        >
          <Trash2 size={13} /> Delete
        </button>
      </td>
    </tr>
  );
}

function NewUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: { title: string; username: string; password: string }) => void }) {
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'admin' | 'owner'>('admin');
  const m = useMutation({
    mutationFn: () => api.post<{ username: string; generated_password?: string }>('/users', { username: username.trim(), role }),
    onSuccess: (r) => {
      if (r.generated_password) {
        onCreated({ title: `User ${r.username} created`, username: r.username, password: r.generated_password });
      } else {
        toast(`User ${r.username} created`);
      }
    },
    onError: (e: any) => toast(e.message ?? String(e), 'err'),
  });
  return (
    <Modal open onClose={onClose} title="New user">
      <div className="space-y-3">
        <div>
          <label className="label">Username</label>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="jane.smith"
            autoFocus
          />
          <p className="mt-1 text-xs text-muted">Letters, digits, and <code>.</code> <code>_</code> <code>@</code> <code>-</code>. A strong random password will be generated and shown once on the next screen.</p>
        </div>
        <div>
          <label className="label">Role</label>
          <SearchSelect
            value={role}
            onChange={(v) => setRole(v as 'admin' | 'owner')}
            options={[
              { value: 'admin', label: 'Admin', sublabel: 'Full access' },
              { value: 'owner', label: 'Owner', sublabel: 'Full access (same permissions; label only)' },
            ]}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => m.mutate()} disabled={!username.trim() || m.isPending}>
            {m.isPending ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CredentialModal({ title, username, password, onClose }: { title: string; username?: string; password: string; onClose: () => void }) {
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast('Copied'));
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-3">
        <p className="text-sm text-red">
          Write this down now. The password is shown <strong>only once</strong> — close this dialog and it's gone.
        </p>
        {username && (
          <div>
            <label className="label">Username</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-paper px-3 py-2 font-mono text-sm">{username}</code>
              <button className="btn-ghost" onClick={() => copy(username)}><Copy size={14} /></button>
            </div>
          </div>
        )}
        <div>
          <label className="label">Password</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-paper px-3 py-2 font-mono text-sm">{password}</code>
            <button className="btn-ghost" onClick={() => copy(password)}><Copy size={14} /></button>
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <button className="btn-primary" onClick={onClose}>I've recorded it</button>
        </div>
      </div>
    </Modal>
  );
}
