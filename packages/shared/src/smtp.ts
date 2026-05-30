/**
 * Pure resolver for per-user invoice email sending (Phase 17 extension).
 *
 * "Both, with fallback": a user may provide full SMTP credentials (used if
 * present and enabled), OR just a From address that rides the company relay.
 * Falls back entirely to the global settings SMTP. No secrets are handled here —
 * it returns a *plan* and the caller decrypts the chosen source's password.
 */
export interface SmtpProfile {
  smtpEnabled: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpFromAddress: string | null;
  smtpFromName: string | null;
  /** whether an encrypted password exists for this profile */
  hasPassword: boolean;
}

export type CredsSource = 'user' | 'global';

export interface SmtpPlan {
  ok: boolean;
  error?: string;
  /** which profile supplies host/port/auth */
  credsSource?: CredsSource;
  host?: string;
  port?: number;
  /** SMTP AUTH username (may be null for unauthenticated relays) */
  authUser?: string | null;
  /** which profile supplies AUTH password (caller decrypts it) */
  passwordSource?: CredsSource | null;
  from: { address: string | null; name: string | null };
  replyTo?: string | null;
}

const usable = (p?: SmtpProfile | null) => !!(p && p.smtpEnabled && p.smtpHost);

export function resolveSmtp(user: SmtpProfile | null, global: SmtpProfile | null): SmtpPlan {
  const credsSource: CredsSource | undefined = usable(user) ? 'user' : usable(global) ? 'global' : undefined;
  // From address prefers the user's identity so the mail appears to come from them.
  const fromAddress = user?.smtpFromAddress || global?.smtpFromAddress || null;
  const fromName = user?.smtpFromName ?? global?.smtpFromName ?? null;
  const replyTo = user?.smtpFromAddress || null;

  if (!credsSource) {
    return { ok: false, error: 'no_smtp', from: { address: fromAddress, name: fromName } };
  }
  const src = credsSource === 'user' ? (user as SmtpProfile) : (global as SmtpProfile);
  return {
    ok: true,
    credsSource,
    host: src.smtpHost as string,
    port: src.smtpPort ?? 587,
    authUser: src.smtpUser ?? null,
    passwordSource: src.hasPassword ? credsSource : null,
    from: { address: fromAddress || src.smtpUser || null, name: fromName },
    replyTo,
  };
}
