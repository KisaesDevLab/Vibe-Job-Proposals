import { Queue } from 'bullmq';
import { connection } from './connection.js';

export const docxToPdfQueue = new Queue('docx-to-pdf', { connection: connection as any });

export async function enqueueDocxToPdf(invoiceId: string): Promise<void> {
  await docxToPdfQueue.add('convert', { invoiceId }, { attempts: 2, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100, removeOnFail: 200 });
}
