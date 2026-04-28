import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts?(x)', 'src/**/*.test.ts?(x)'],
    environmentMatchGlobs: [['src/renderer/**', 'jsdom']],
    setupFiles: [],
  },
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
  },
});
