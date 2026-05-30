// AES-256-GCM secret encryption for SMTP passwords at rest (Phase 17).
// Format: base64(iv):base64(authTag):base64(ciphertext). Matches the worker's
// decrypt in packages/workers/src/send-email.ts.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keyFromEnv(): Buffer {
  const keyHex = process.env.SMTP_ENC_KEY ?? '';
  if (!keyHex) throw new Error('SMTP_ENC_KEY is not set');
  return Buffer.from(keyHex.length === 64 ? keyHex : Buffer.from(keyHex).toString('hex').slice(0, 64), 'hex');
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromEnv(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(enc: string): string {
  const [iv, tag, data] = enc.split(':');
  const dec = createDecipheriv('aes-256-gcm', keyFromEnv(), Buffer.from(iv, 'base64'));
  dec.setAuthTag(Buffer.from(tag, 'base64'));
  return dec.update(Buffer.from(data, 'base64')).toString('utf8') + dec.final('utf8');
}
