// The popup end to end: the built extension in bundled Chromium, its page opened in a tab, with every
// network request answered from the recorded HN and Reddit fixtures.

import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page, Route, Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';
import { expect, test } from './fixtures';

// `chrome` inside `serviceWorker.evaluate()` callbacks is the extension's own global.
declare const chrome: typeof browser;

const ARTICLE = 'https://xkcd.com/927/';
const FIXTURES = path.resolve(import.meta.dirname, '../src/core/providers/__fixtures__');
const EMPTY_LISTING = { kind: 'Listing', data: { after: null, children: [] } };

function fixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function fulfillJson(route: Route, body: string): Promise<void> {
  return route.fulfill({ contentType: 'application/json; charset=UTF-8', body });
}

/**
 * Answers HN and Reddit for xkcd.com/927 and aborts everything else. Signed out, old.reddit.com
 * redirects every request to its login page (served by the `loginServer` fixture), as it does for a
 * browser without a Reddit session.
 */
async function mockNetwork(
  context: BrowserContext,
  { reddit = 'signed-in' }: { reddit?: 'signed-in' | 'signed-out' } = {},
): Promise<void> {
  // The last matching route wins, so the catch-all comes first.
  await context.route(
    (url) => url.protocol === 'http:' || url.protocol === 'https:',
    (route) => route.abort(),
  );
  await context.route(
    (url) => url.origin === 'https://hn.algolia.com',
    (route) => fulfillJson(route, fixture('hn-search-xkcd-927.json')),
  );
  await context.route(
    (url) => url.origin === 'https://old.reddit.com' && !url.pathname.startsWith('/login'),
    (route) => {
      if (reddit === 'signed-out') {
        const dest = encodeURIComponent(route.request().url());
        return route.fulfill({
          status: 302,
          headers: { location: `https://old.reddit.com/login/?reason=lor2&dest=${dest}` },
        });
      }
      const { pathname } = new URL(route.request().url());
      if (pathname === '/search.json')
        return fulfillJson(route, fixture('reddit-search-xkcd-927.json'));
      if (pathname === '/api/info.json')
        return fulfillJson(route, fixture('reddit-info-xkcd-927.json'));
      // Other submissions of the best match: none beyond what search found.
      return fulfillJson(route, JSON.stringify([EMPTY_LISTING, EMPTY_LISTING]));
    },
  );
}

async function confirmOnboarding(serviceWorker: Worker): Promise<void> {
  await serviceWorker.evaluate(() => chrome.storage.local.set({ onboarded: true }));
}

async function openPopup(context: BrowserContext, extensionId: string, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html?url=${encodeURIComponent(url)}`);
  return page;
}

test('lists the discussions of a page from both sources', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await mockNetwork(context);
  await confirmOnboarding(serviceWorker);
  const popup = await openPopup(context, extensionId, ARTICLE);

  // Counts from the fixtures: 6 on HN, 9 on Reddit (search and old.reddit's exact index together).
  await expect(popup.getByRole('radio', { name: 'All 15' })).toBeChecked();
  await expect(popup.getByRole('radio', { name: 'HN 6' })).toBeVisible();
  await expect(popup.getByRole('radio', { name: 'Reddit 9' })).toBeVisible();
  const rows = popup.getByRole('list', { name: 'Discussions' }).getByRole('link');
  // Most points first; the first row's name is its title and its score (upvotes on Reddit).
  await expect(rows.first()).toHaveAccessibleName('xkcd: Standards 1,042 upvotes');
  await expect(rows.first()).toHaveAttribute('href', /^https:\/\/www\.reddit\.com\/r\/comics\//);
  await expect(popup.getByRole('button', { name: '+6 more with no comments' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Other versions 1' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  // Showing only Hacker News (the filter is a radio group: arrow keys move the choice).
  await popup.getByRole('radio', { name: 'All 15' }).focus();
  await popup.keyboard.press('ArrowRight');
  await expect(popup.getByRole('radio', { name: 'HN 6' })).toBeChecked();
  await expect(rows.first()).toHaveAttribute(
    'href',
    /^https:\/\/news\.ycombinator\.com\/item\?id=/,
  );
});

test('offers to sign in when Reddit has no session', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await mockNetwork(context, { reddit: 'signed-out' });
  await confirmOnboarding(serviceWorker);
  const popup = await openPopup(context, extensionId, ARTICLE);

  await expect(popup.getByText('Reddit: not signed in', { exact: true })).toBeVisible();
  await expect(popup.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute(
    'href',
    'https://www.reddit.com/login',
  );
  // Hacker News results still show.
  await expect(popup.getByText('6 on Hacker News')).toBeVisible();
  await expect(popup.getByRole('list', { name: 'Discussions' }).getByRole('link')).toHaveCount(1);
});
