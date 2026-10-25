import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // WxtVitest adds the `@/` alias and `#imports`, and stands in fakeBrowser for the extension APIs.
  plugins: [WxtVitest()],
  // Unit tests only; the Playwright specs in e2e/ run with `npm run test:e2e`.
  test: { include: ['src/**/*.test.ts'] },
});
