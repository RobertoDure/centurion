import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/full-e2e.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
