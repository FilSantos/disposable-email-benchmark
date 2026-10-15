import { defineConfig } from '@playwright/test';

/**
 * Playwright is used for the UI channel of the benchmark and for external
 * provider E2E tests. Provider UI tests are opt-in (gated by env) because they
 * hit third-party sites and must respect provider terms and rate limits.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  outputDir: 'reports/playwright-artifacts',
});
