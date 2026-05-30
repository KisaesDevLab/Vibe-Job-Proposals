import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal, toast } from './ui';

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const m = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => {
      toast('Password changed');
      setCurrent('');
      setNew('');
      setConfirm('');
      onClose();
    },
    onError: (e: any) => toast(e.message, 'err'),
  });
  const tooShort = newPassword.length > 0 && newPassword.length < 12;
  const mismatch = confirm.length > 0 && confirm !== newPassword;
  return (
    <Modal open={open} onClose={onClose} title="Change password">
      <div className="space-y-3">
        <div><label className="label">Current password</label><input className="input" type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div>
          <label className="label">New password</label>
          <input className="input" type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
          {tooShort && <p className="mt-1 text-xs text-red">Must be at least 12 characters.</p>}
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {mismatch && <p className="mt-1 text-xs text-red">Passwords don't match.</p>}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!currentPassword || newPassword.length < 12 || newPassword !== confirm || m.isPending}
            onClick={() => m.mutate()}
          >
            Change password
          </button>
        </div>
      </div>
    </Modal>
  );
}
