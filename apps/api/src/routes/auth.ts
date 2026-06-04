import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { z } from 'zod';
import { ok, fail, loginSchema, changePasswordSchema } from '@darrow/shared';
import { db, users } from '@darrow/db';
import { eq } from 'drizzle-orm';
import { redis } from '../redis.js';
import { ah, HttpError } from '../error-handler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../audit.js';
import { logger } from '../logger.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args: string[]) => (redis as any).call(...args) }),
  message: fail('rate_limited', 'Too many login attempts; try again later'),
});

authRouter.post(
  '/login',
  loginLimiter,
  ah(async (req: AuthedRequest, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const [u] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!u || !u.active || !(await bcrypt.compare(password, u.passwordHash))) {
      return res.status(401).json(fail('invalid_credentials', 'Invalid username or password'));
    }
    // Regenerate the session on login to defeat session fixation.
    await new Promise<void>((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.userId = u.id;
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
    res.json(ok({ id: u.id, username: u.username, role: u.role }));
  }),
);

authRouter.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    // Clear the cookie regardless so the client is logged out, but don't
    // silently swallow a store failure — the server-side session may persist.
    if (err) logger.warn('session destroy failed during logout', { err: String(err) });
    res.clearCookie('connect.sid');
    res.json(ok({ loggedOut: true }));
  });
});

authRouter.get(
  '/me',
  ah(async (req: AuthedRequest, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json(fail('unauthorized', 'Not logged in'));
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u || !u.active) return res.status(401).json(fail('unauthorized', 'Session invalid'));
    res.json(ok({ id: u.id, username: u.username, role: u.role }));
  }),
);

authRouter.post(
  '/change-password',
  ah(async (req: AuthedRequest, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json(fail('unauthorized', 'Not logged in'));
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u || !(await bcrypt.compare(currentPassword, u.passwordHash))) {
      return res.status(400).json(fail('invalid_credentials', 'Current password incorrect'));
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await db.update(users).set({ passwordHash: hash }).where(eq(users.id, userId));
    await writeAudit({ userId, entityType: 'user', entityId: userId, action: 'update', summary: 'Changed password' });
    res.json(ok({ changed: true }));
  }),
);

// ---- Per-user SMTP sender settings (Phase 17 extension) ----
function requireUser(req: AuthedRequest): string {
  const id = req.session?.userId;
  if (!id) throw new HttpError(401, 'unauthorized', 'Not logged in');
  return id;
}

const userSmtpSchema = z.object({
  smtp_host: z.string().nullable().optional(),
  smtp_port: z.coerce.number().int().nullable().optional(),
  smtp_user: z.string().nullable().optional(),
  smtp_password: z.string().nullable().optional(),
  smtp_from_address: z.string().email().nullable().optional().or(z.literal('')),
  smtp_from_name: z.string().nullable().optional(),
  smtp_enabled: z.boolean().optional(),
});

authRouter.get(
  '/smtp',
  ah(async (req: AuthedRequest, res) => {
    const userId = requireUser(req);
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    res.json(
      ok({
        smtp_host: u.smtpHost,
        smtp_port: u.smtpPort,
        smtp_user: u.smtpUser,
        smtp_from_address: u.smtpFromAddress,
        smtp_from_name: u.smtpFromName,
        smtp_enabled: u.smtpEnabled,
        smtp_password_set: !!u.smtpPasswordEnc,
      }),
    );
  }),
);

authRouter.put(
  '/smtp',
  ah(async (req: AuthedRequest, res) => {
    const userId = requireUser(req);
    const body = userSmtpSchema.parse(req.body);
    if ((body.smtp_enabled || body.smtp_password) && !process.env.SMTP_ENC_KEY) {
      return res.status(400).json(fail('no_enc_key', 'SMTP_ENC_KEY must be set to store SMTP credentials'));
    }
    await db
      .update(users)
      .set({
        smtpHost: body.smtp_host ?? undefined,
        smtpPort: body.smtp_port ?? undefined,
        smtpUser: body.smtp_user ?? undefined,
        smtpPasswordEnc: body.smtp_password ? encryptSecret(body.smtp_password) : undefined,
        smtpFromAddress: body.smtp_from_address === '' ? null : body.smtp_from_address ?? undefined,
        smtpFromName: body.smtp_from_name ?? undefined,
        smtpEnabled: body.smtp_enabled,
      })
      .where(eq(users.id, userId));
    await writeAudit({ userId, entityType: 'user', entityId: userId, action: 'update', summary: 'Updated personal SMTP settings' });
    res.json(ok({ updated: true }));
  }),
);

authRouter.post(
  '/smtp/test',
  ah(async (req: AuthedRequest, res) => {
    const userId = requireUser(req);
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    if (!u.smtpHost) return res.status(400).json(fail('not_configured', 'No personal SMTP host configured'));
    const nodemailer = (await import('nodemailer')).default;
    let pass: string | undefined;
    if (u.smtpPasswordEnc && process.env.SMTP_ENC_KEY) {
      try {
        pass = decryptSecret(u.smtpPasswordEnc);
      } catch {
        return res.status(400).json(fail('decrypt_failed', 'Could not decrypt stored password'));
      }
    }
    const transport = nodemailer.createTransport({
      host: u.smtpHost,
      port: u.smtpPort ?? 587,
      secure: (u.smtpPort ?? 587) === 465,
      auth: u.smtpUser ? { user: u.smtpUser, pass } : undefined,
    });
    try {
      await transport.verify();
      // Test mail goes only to the user's own From address — never an arbitrary recipient.
      const to = u.smtpFromAddress;
      if (to) {
        await transport.sendMail({
          from: u.smtpFromName ? `"${u.smtpFromName}" <${u.smtpFromAddress}>` : u.smtpFromAddress ?? to,
          to,
          subject: 'Darrow personal SMTP test',
          text: 'Your personal SMTP settings work.',
        });
      }
      res.json(ok({ verified: true, sentTo: to ?? null }));
    } catch (e: any) {
      res.status(400).json(fail('smtp_failed', e?.message ?? 'SMTP test failed'));
    }
  }),
);
