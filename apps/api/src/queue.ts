// BullMQ queue producers. Workers (packages/workers) consume these.
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const QUEUE_NAMES = {
  imageToPdf: 'image-to-pdf',
  inboxToPdf: 'inbox-to-pdf',
  renderDocx: 'render-docx',
  docxToPdf: 'docx-to-pdf',
  sendEmail: 'send-invoice-email',
} as const;

export const imageToPdfQueue = new Queue(QUEUE_NAMES.imageToPdf, { connection: connection as any });
export const inboxToPdfQueue = new Queue(QUEUE_NAMES.inboxToPdf, { connection: connection as any });
export const renderDocxQueue = new Queue(QUEUE_NAMES.renderDocx, { connection: connection as any });
export const docxToPdfQueue = new Queue(QUEUE_NAMES.docxToPdf, { connection: connection as any });
export const sendEmailQueue = new Queue(QUEUE_NAMES.sendEmail, { connection: connection as any });

const defaultOpts = { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100, removeOnFail: 200 };

export async function enqueueImageToPdf(attachmentId: string): Promise<void> {
  await imageToPdfQueue.add('convert', { attachmentId }, defaultOpts);
}
export async function enqueueInboxToPdf(docId: string): Promise<void> {
  await inboxToPdfQueue.add('convert', { docId }, defaultOpts);
}
export async function enqueueRenderDocx(invoiceId: string): Promise<void> {
  await renderDocxQueue.add('render', { invoiceId }, { ...defaultOpts, attempts: 3 });
}
export async function enqueueDocxToPdf(invoiceId: string): Promise<void> {
  await docxToPdfQueue.add('convert', { invoiceId }, { ...defaultOpts, attempts: 2 });
}
export async function enqueueSendEmail(emailId: string): Promise<void> {
  await sendEmailQueue.add('send', { emailId }, { ...defaultOpts, attempts: 3 });
}

export async function redisPing(): Promise<boolean> {
  try {
    const r = await connection.ping();
    return r === 'PONG';
  } catch (err) {
    logger.warn('redis ping failed', { err: String(err) });
    return false;
  }
}
