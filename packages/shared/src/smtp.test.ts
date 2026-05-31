import { describe, it, expect } from 'vitest';
import { resolveSmtp, type SmtpProfile } from './smtp.js';

const prof = (p: Partial<SmtpProfile>): SmtpProfile => ({
  smtpEnabled: false,
  smtpHost: null,
  smtpPort: null,
  smtpUser: null,
  smtpFromAddress: null,
  smtpFromName: null,
  hasPassword: false,
  ...p,
});

describe('resolveSmtp (per-user with fallback)', () => {
  it('uses full per-user credentials when enabled', () => {
    const user = prof({ smtpEnabled: true, smtpHost: 'smtp.user', smtpPort: 587, smtpUser: 'u@user', smtpFromAddress: 'u@user', hasPassword: true });
    const global = prof({ smtpEnabled: true, smtpHost: 'smtp.co', smtpFromAddress: 'billing@co' });
    const plan = resolveSmtp(user, global);
    expect(plan.ok).toBe(true);
    expect(plan.credsSource).toBe('user');
    expect(plan.host).toBe('smtp.user');
    expect(plan.passwordSource).toBe('user');
    expect(plan.from.address).toBe('u@user');
    expect(plan.replyTo).toBe('u@user');
  });

  it('rides the global relay but keeps the user From when the user has no host', () => {
    const user = prof({ smtpFromAddress: 'alice@firm', smtpFromName: 'Alice' });
    const global = prof({ smtpEnabled: true, smtpHost: 'smtp.co', smtpUser: 'relay', smtpFromAddress: 'billing@co', hasPassword: true });
    const plan = resolveSmtp(user, global);
    expect(plan.ok).toBe(true);
    expect(plan.credsSource).toBe('global'); // relay
    expect(plan.from.address).toBe('alice@firm'); // appears from the user
    expect(plan.from.name).toBe('Alice');
    expect(plan.replyTo).toBe('alice@firm');
    expect(plan.passwordSource).toBe('global');
  });

  it('falls back entirely to the global relay when the user has nothing', () => {
    const plan = resolveSmtp(prof({}), prof({ smtpEnabled: true, smtpHost: 'smtp.co', smtpFromAddress: 'billing@co' }));
    expect(plan.ok).toBe(true);
    expect(plan.credsSource).toBe('global');
    expect(plan.from.address).toBe('billing@co');
  });

  it('errors when neither user nor global is usable', () => {
    const plan = resolveSmtp(prof({ smtpFromAddress: 'a@b' }), prof({ smtpHost: 'smtp.co' /* not enabled */ }));
    expect(plan.ok).toBe(false);
    expect(plan.error).toBe('no_smtp');
  });

  it('ignores a user profile that has a host but is not enabled', () => {
    const user = prof({ smtpHost: 'smtp.user', smtpEnabled: false });
    const global = prof({ smtpEnabled: true, smtpHost: 'smtp.co' });
    expect(resolveSmtp(user, global).credsSource).toBe('global');
  });
});
