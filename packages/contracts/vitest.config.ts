import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        statements: 100,
        lines: 100,
        functions: 100,
        branches: 100,
      },
    },
  },
});
