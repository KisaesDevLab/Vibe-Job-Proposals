// send-invoice-email worker (Phase 17). Decrypts SMTP password (AES-256-GCM),
// sends via nodemailer with docx/pdf attachments.
import { Worker } from 'bullmq';
import { createDecipheriv } from 'node:crypto';
import { existsSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { sql } from '@darrow/db';
import { resolveSmtp, type SmtpProfile } from '@darrow/shared';
import { connection, logger } from './connection.js';

export function decryptSecret(enc: string, keyHex: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error('SMTP_ENC_KEY must be exactly 64 hex characters (32 bytes)');
  const key = Buffer.from(keyHex, 'hex');
  const [ivB64, tagB64, dataB64] = enc.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return decipher.update(Buffer.from(dataB64, 'base64')).toString('utf8') + decipher.final('utf8');
}

const profileOf = (r: any): SmtpProfile => ({
  smtpEnabled: !!r?.smtp_enabled,
  smtpHost: r?.smtp_host ?? null,
  smtpPort: r?.smtp_port ?? null,
  smtpUser: r?.smtp_user ?? null,
  smtpFromAddress: r?.smtp_from_address ?? null,
  smtpFromName: r?.smtp_from_name ?? null,
  hasPassword: !!r?.smtp_password_enc,
});

async function send(emailId: string): Promise<void> {
  const [em] = await sql<any[]>`SELECT * FROM invoice_emails WHERE id=${emailId}`;
  if (!em) throw new Error('email record not found');
  const [global] = await sql<any[]>`SELECT * FROM settings WHERE id=1`;
  const [user] = em.sent_by_user_id ? await sql<any[]>`SELECT * FROM users WHERE id=${em.sent_by_user_id}` : [null];

  // Resolve which profile sends (per-user creds -> global relay), and the From.
  const plan = resolveSmtp(user ? profileOf(user) : null, global ? profileOf(global) : null);
  if (!plan.ok) throw new Error('SMTP not configured (neither the sending user nor the company relay is enabled)');

  const key = process.env.SMTP_ENC_KEY;
  let password: string | undefined;
  if (plan.passwordSource && key) {
    const enc = plan.passwordSource === 'user' ? user?.smtp_password_enc : global?.smtp_password_enc;
    if (enc) password = decryptSecret(enc, key);
  }

  const transport = nodemailer.createTransport({
    host: plan.host,
    port: plan.port,
    secure: plan.port === 465,
    auth: plan.authUser ? { user: plan.authUser, pass: password } : undefined,
  });

  const [inv] = await sql<any[]>`SELECT generated_docx_path, generated_pdf_path, billed_reference FROM invoices WHERE id=${em.invoice_id}`;
  const attachments = [];
  if (em.included_docx && inv?.generated_docx_path && existsSync(inv.generated_docx_path))
    attachments.push({ filename: `${inv.billed_reference}.docx`, path: inv.generated_docx_path });
  if (em.included_pdf && inv?.generated_pdf_path && existsSync(inv.generated_pdf_path))
    attachments.push({ filename: `${inv.billed_reference}.pdf`, path: inv.generated_pdf_path });

  const from = plan.from.name ? `"${plan.from.name}" <${plan.from.address}>` : plan.from.address ?? undefined;
  const info = await transport.sendMail({
    from,
    replyTo: plan.replyTo ?? undefined,
    to: em.to_address,
    cc: em.cc_addresses,
    subject: em.subject,
    text: em.body,
    attachments,
  });
  await sql`UPDATE invoice_emails SET sent_at=now(), smtp_message_id=${info.messageId ?? null}, error=NULL WHERE id=${emailId}`;
  logger.info('email sent', { emailId, messageId: info.messageId, credsSource: plan.credsSource, from: plan.from.address });
}

export function startSendEmailWorker(): Worker {
  const worker = new Worker('send-invoice-email', async (job) => send(job.data.emailId), { connection, concurrency: 2 });
  worker.on('failed', async (job, err) => {
    logger.error('send-email failed', { emailId: job?.data?.emailId, err: String(err) });
    if (job) await sql`UPDATE invoice_emails SET error=${String(err)} WHERE id=${job.data.emailId}`;
  });
  return worker;
}
