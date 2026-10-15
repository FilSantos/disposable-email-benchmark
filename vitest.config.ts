import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // External provider E2E lives in tests/e2e and is run separately by Playwright.
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
  },
});
