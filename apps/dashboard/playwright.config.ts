import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.DASHBOARD_PORT ?? 5173);
const baseURL = process.env.DASHBOARD_URL ?? `http://localhost:${port}`;

/**
 * Dashboard smoke test (T7.7). By default it runs against the Vite dev server
 * with MSW, so no API/infra is required. Point DASHBOARD_URL at a deployed
 * dashboard (and set VITE_ENABLE_MSW=false when starting it) for real-API runs.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(process.env.DASHBOARD_URL === undefined
    ? {
        webServer: {
          command: `pnpm exec vite --port ${port} --strictPort`,
          url: baseURL,
          reuseExistingServer: true,
          timeout: 60_000,
          env: { VITE_ENABLE_MSW: process.env.VITE_ENABLE_MSW ?? 'true' },
        },
      }
    : {}),
});
