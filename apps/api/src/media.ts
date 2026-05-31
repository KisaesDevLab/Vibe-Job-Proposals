// Probe sharp's HEIC/HEIF support once at boot (Phase 10 task 9).
import { logger } from './logger.js';

let heic = false;
let probed = false;

export async function probeMedia(): Promise<void> {
  if (probed) return;
  probed = true;
  try {
    const sharp = (await import('sharp')).default;
    heic = Boolean((sharp.format as any)?.heif?.input);
    logger.info('media probe', { heicSupport: heic });
  } catch (err) {
    logger.warn('sharp not available; HEIC disabled', { err: String(err) });
    heic = false;
  }
}

export function hasHeicSupport(): boolean {
  return heic;
}
