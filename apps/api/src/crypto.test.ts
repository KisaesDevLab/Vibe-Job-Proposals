// Fail-closed guarantees for the at-rest secret encryption (Phase 17 / tunnel).
// A decrypt must NEVER silently return a wrong/default value — a tampered
// ciphertext, wrong key, or missing key must throw so callers can't proceed
// with a bogus credential.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptSecret, decryptSecret } from './crypto.js';

const KEY = 'a'.repeat(64); // 32 bytes as hex
const ORIGINAL = process.env.SMTP_ENC_KEY;

describe('crypto secret encryption (AES-256-GCM, fail-closed)', () => {
  beforeEach(() => { process.env.SMTP_ENC_KEY = KEY; });
  afterEach(() => { if (ORIGINAL === undefined) delete process.env.SMTP_ENC_KEY; else process.env.SMTP_ENC_KEY = ORIGINAL; });

  it('round-trips a secret without exposing the plaintext in the ciphertext', () => {
    const enc = encryptSecret('hunter2-correct-horse');
    expect(enc).not.toContain('hunter2');
    expect(decryptSecret(enc)).toBe('hunter2-correct-horse');
  });

  it('throws when the ciphertext is tampered (auth-tag mismatch)', () => {
    const enc = encryptSecret('hunter2');
    const [iv, tag, data] = enc.split(':');
    const bad = Buffer.from(data, 'base64');
    bad[0] ^= 0xff; // flip a byte
    expect(() => decryptSecret(`${iv}:${tag}:${bad.toString('base64')}`)).toThrow();
  });

  it('throws when decrypted with the wrong key (does not return garbage plaintext)', () => {
    const enc = encryptSecret('hunter2');
    process.env.SMTP_ENC_KEY = 'b'.repeat(64);
    expect(() => decryptSecret(enc)).toThrow();
  });

  it('throws when the key is missing — never falls back to a default', () => {
    const enc = encryptSecret('hunter2');
    delete process.env.SMTP_ENC_KEY;
    expect(() => decryptSecret(enc)).toThrow(/64 hex/);
  });
});
