// send-invoice-email worker (Phase 17). Decrypts SMTP password (AES-256-GCM),
// sends via nodemailer with docx/pdf attachments.
import { Worker } from 'bullmq';
import { createDecipheriv } from 'node:crypto';
import { existsSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { sql } from '@darrow/db';
import { connection, logger } from './connection.js';

export function decryptSecret(enc: string, keyHex: string): string {
  const key = Buffer.from(keyHex.length === 64 ? keyHex : Buffer.from(keyHex).toString('hex').slice(0, 64), 'hex');
  const [ivB64, tagB64, dataB64] = enc.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return decipher.update(Buffer.from(dataB64, 'base64')).toString('utf8') + decipher.final('utf8');
}

async function send(emailId: string): Promise<void> {
  const [em] = await sql<any[]>`SELECT * FROM invoice_emails WHERE id=${emailId}`;
  if (!em) throw new Error('email record not found');
  const [s] = await sql<any[]>`SELECT * FROM settings WHERE id=1`;
  if (!s?.smtp_enabled) throw new Error('SMTP not enabled');
  const password = s.smtp_password_enc && process.env.SMTP_ENC_KEY ? decryptSecret(s.smtp_password_enc, process.env.SMTP_ENC_KEY) : undefined;
  const transport = nodemailer.createTransport({
    host: s.smtp_host,
    port: s.smtp_port ?? 587,
    secure: (s.smtp_port ?? 587) === 465,
    auth: s.smtp_user ? { user: s.smtp_user, pass: password } : undefined,
  });
  const [inv] = await sql<any[]>`SELECT generated_docx_path, generated_pdf_path, billed_reference FROM invoices WHERE id=${em.invoice_id}`;
  const attachments = [];
  if (em.included_docx && inv?.generated_docx_path && existsSync(inv.generated_docx_path))
    attachments.push({ filename: `${inv.billed_reference}.docx`, path: inv.generated_docx_path });
  if (em.included_pdf && inv?.generated_pdf_path && existsSync(inv.generated_pdf_path))
    attachments.push({ filename: `${inv.billed_reference}.pdf`, path: inv.generated_pdf_path });

  const info = await transport.sendMail({
    from: s.smtp_from_name ? `"${s.smtp_from_name}" <${s.smtp_from_address}>` : s.smtp_from_address,
    to: em.to_address,
    cc: em.cc_addresses,
    subject: em.subject,
    text: em.body,
    attachments,
  });
  await sql`UPDATE invoice_emails SET sent_at=now(), smtp_message_id=${info.messageId ?? null}, error=NULL WHERE id=${emailId}`;
  logger.info('email sent', { emailId, messageId: info.messageId });
}

export function startSendEmailWorker(): Worker {
  const worker = new Worker('send-invoice-email', async (job) => send(job.data.emailId), { connection, concurrency: 2 });
  worker.on('failed', async (job, err) => {
    logger.error('send-email failed', { emailId: job?.data?.emailId, err: String(err) });
    if (job) await sql`UPDATE invoice_emails SET error=${String(err)} WHERE id=${job.data.emailId}`;
  });
  return worker;
}
