import { defineConfig } from '@playwright/test';

const ci = Boolean(process.env['CI']);

// The extension is loaded from `.output/chrome-mv3`; `npm run test:e2e` builds it first.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
});
