import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { initStorage } from './storage.js';
import { probeMedia } from './media.js';

async function main() {
  initStorage();
  await probeMedia();
  const app = createApp();
  const server = app.listen(config.PORT, () => {
    logger.info(`API listening on :${config.PORT}`, { env: config.NODE_ENV });
  });
  // Drop slow/stuck requests (DoS hardening).
  server.requestTimeout = 60_000;
  server.headersTimeout = 65_000;
}

main().catch((err) => {
  logger.error('fatal boot error', { err: String(err), stack: (err as Error)?.stack });
  process.exit(1);
});
