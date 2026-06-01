// AES-256-GCM secret encryption for secrets at rest.
// Format: base64(iv):base64(authTag):base64(ciphertext). Matches the worker's
// decrypt in packages/workers/src/send-email.ts.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keyFromHex(envName: string): Buffer {
  const keyHex = process.env[envName] ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(`${envName} must be exactly 64 hex characters (32 bytes)`);
  }
  return Buffer.from(keyHex, 'hex');
}

function enc(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}
function dec(key: Buffer, encStr: string): string {
  const [iv, tag, data] = encStr.split(':');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return d.update(Buffer.from(data, 'base64')).toString('utf8') + d.final('utf8');
}

// SMTP credentials (Phase 17) — bound to SMTP_ENC_KEY.
export function encryptSecret(plain: string): string { return enc(keyFromHex('SMTP_ENC_KEY'), plain); }
export function decryptSecret(encStr: string): string { return dec(keyFromHex('SMTP_ENC_KEY'), encStr); }

// Cloudflare Tunnel tokens — bound to TUNNEL_ENC_KEY (separate from SMTP so the
// keys can be rotated independently).
export function encryptTunnelSecret(plain: string): string { return enc(keyFromHex('TUNNEL_ENC_KEY'), plain); }
export function decryptTunnelSecret(encStr: string): string { return dec(keyFromHex('TUNNEL_ENC_KEY'), encStr); }
