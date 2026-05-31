import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@darrow/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@darrow/db': resolve(__dirname, 'packages/db/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/web/**', '**/e2e/**'],
    testTimeout: 30000,
    coverage: { provider: 'v8', include: ['packages/shared/src/pricing.ts'] },
  },
});
