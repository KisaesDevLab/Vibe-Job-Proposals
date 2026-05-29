import { useState } from 'react';
import { Zap } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui';

export function LoginPage() {
  const { refresh } = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/login', { username, password });
      refresh();
      window.location.href = '/time';
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid h-full place-items-center bg-paper">
      <form onSubmit={submit} className="card w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-copper text-white"><Zap size={24} /></div>
          <div>
            <div className="text-lg font-bold">Darrow Electric</div>
            <div className="text-xs text-muted">Time &amp; Invoicing</div>
          </div>
        </div>
        <label className="label">Username</label>
        <input className="input mb-4" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <label className="label">Password</label>
        <input className="input mb-4" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="mb-4 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
        <button className="btn-primary w-full justify-center" disabled={loading}>
          {loading ? <Spinner /> : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
