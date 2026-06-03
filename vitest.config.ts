import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    // Limit parallelism to avoid exhausting system memory
    pool: 'forks',
    poolOptions: {
      forks: { maxForks: 2, minForks: 1 },
    },
    maxWorkers: 2,
    minWorkers: 1,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts?(x)', 'src/**/*.test.ts?(x)'],
    environmentMatchGlobs: [['src/renderer/**', 'jsdom']],
    setupFiles: ['src/renderer/test-setup.ts'],
  },
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
  },
});
