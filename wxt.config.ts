import { defineConfig } from 'wxt';

// The version comes from package.json; WXT copies it into the manifest.
export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  targetBrowsers: ['chrome'],
  // Explicit imports only (`#imports`, `wxt/browser`, ...), no auto-imported globals.
  imports: false,
  modules: ['@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: 'assets/icon.svg',
    // Keep the production icon in dev builds instead of the grayscale "DEV" variant.
    developmentIndicator: false,
  },
  // Developers load `.output/chrome-mv3-dev` into their own signed-in Chrome profile (needed for
  // Reddit), and branded Chrome 137+ ignores `--load-extension`, so WXT never launches a browser.
  webExt: { disabled: true },
  vite: () => ({
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  }),
  // `action` (default_popup, default_title from the popup <title>) and `options_ui` (open_in_tab
  // from a <meta> tag) are generated from the popup and options entrypoints.
  manifest: {
    name: 'Find On - Look up current page on Hacker News & Reddit',
    short_name: 'Find On',
    description: "Find Hacker News and Reddit discussions of the page you're on.",
    minimum_chrome_version: '127',
    permissions: ['storage', 'tabs', 'contextMenus'],
    host_permissions: [
      'https://hn.algolia.com/*',
      'https://www.reddit.com/*',
      'https://old.reddit.com/*',
    ],
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+D' } },
    },
  },
});
