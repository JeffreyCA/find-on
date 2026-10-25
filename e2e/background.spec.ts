// Automatic checks end to end: the built extension in bundled Chromium, with every network request
// answered by Playwright (recorded HN and Reddit fixtures, a fake article page). The badge is read in
// the service worker, the same way Chrome would render it.

import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page, Route, Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';
import { DEFAULT_BLOCK_LIST } from '../src/core/site-filter';
import type { StoredSettings } from '../src/platform/settings';
import { expect, test } from './fixtures';

// `chrome` inside `serviceWorker.evaluate()` callbacks is the extension's own global.
declare const chrome: typeof browser;

const ARTICLE = 'https://xkcd.com/927/';
const FIXTURES = path.resolve(import.meta.dirname, '../src/core/providers/__fixtures__');
/** Comfortably longer than the scheduler's 500 ms debounce plus a cache-miss lookup. */
const SETTLE_MS = 1500;

// Badge count for xkcd.com/927 from the recorded fixtures (SAME + EXACT matches): HN 6, plus
// Reddit 9 from search and old.reddit's exact index together.
const BADGE = '15';

function fixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function fulfillJson(route: Route, name: string): Promise<void> {
  return route.fulfill({ contentType: 'application/json; charset=UTF-8', body: fixture(name) });
}

/**
 * Answers every web request the extension and the article tab make. Unknown ones are aborted and
 * recorded.
 */
async function mockNetwork(
  context: BrowserContext,
): Promise<{ requests: string[]; unexpected: string[] }> {
  const requests: string[] = [];
  const unexpected: string[] = [];
  // The last matching route wins, so the catch-all comes first.
  await context.route(
    (url) => url.protocol === 'http:' || url.protocol === 'https:',
    (route) => {
      unexpected.push(route.request().url());
      return route.abort();
    },
  );
  await context.route(
    (url) => url.href === ARTICLE,
    (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><title>Standards</title><h1>Standards</h1>',
      }),
  );
  await context.route('https://xkcd.com/favicon.ico', (route) => route.fulfill({ status: 404 }));
  const answer = (origin: string, pathname: string | null, name: string) =>
    context.route(
      (url) => url.origin === origin && (pathname === null || url.pathname === pathname),
      (route) => {
        requests.push(route.request().url());
        return fulfillJson(route, name);
      },
    );
  await answer('https://hn.algolia.com', null, 'hn-search-xkcd-927.json');
  await answer('https://www.reddit.com', '/search.json', 'reddit-search-xkcd-927.json');
  await answer('https://old.reddit.com', '/api/info.json', 'reddit-info-xkcd-927.json');
  return { requests, unexpected };
}

const isWelcome = (page: Page) => page.url().endsWith('/welcome.html');

/** The welcome page that install opens, once its Reddit sign-in check has settled. */
async function welcomePage(context: BrowserContext): Promise<Page> {
  await expect.poll(() => context.pages().some(isWelcome)).toBe(true);
  const welcome = context.pages().find(isWelcome);
  if (welcome === undefined) throw new Error('No welcome page');
  // "Check again" (signed in or out) or "Try again" (failed) shows once the check has settled.
  await welcome.getByRole('button', { name: /^(Check|Try) again$/ }).waitFor();
  return welcome;
}

/**
 * Closes the welcome page (so it can no longer steal focus from the article tab) and forgets the
 * requests made so far, then confirms onboarding and stores the settings.
 */
async function prepare(
  context: BrowserContext,
  serviceWorker: Worker,
  network: { requests: string[]; unexpected: string[] },
  settings: StoredSettings = {},
): Promise<void> {
  await (await welcomePage(context)).close();
  network.requests.length = 0;
  network.unexpected.length = 0;
  await serviceWorker.evaluate(async (value) => {
    await chrome.storage.sync.set({ settings: value });
    await chrome.storage.local.set({ onboarded: true });
  }, settings);
}

/** The badge text of the tab showing `url`, or null when there is no such tab. */
function badgeOf(serviceWorker: Worker, url: string): Promise<string | null> {
  return serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    return tab?.id === undefined ? null : chrome.action.getBadgeText({ tabId: tab.id });
  }, url);
}

async function openArticle(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(ARTICLE);
  return page;
}

test('shows the number of discussions on the badge', async ({ context, serviceWorker }) => {
  const network = await mockNetwork(context);
  await prepare(context, serviceWorker, network);
  await openArticle(context);

  await expect.poll(() => badgeOf(serviceWorker, ARTICLE)).toBe(BADGE);
  // An automatic check sends HN one search, and Reddit one search plus one exact-URL lookup.
  expect(network.requests.map((u) => new URL(u).host).toSorted()).toEqual([
    'hn.algolia.com',
    'old.reddit.com',
    'www.reddit.com',
  ]);
  expect(network.unexpected).toEqual([]);
});

test('starts automatic checks with one click on the welcome page', async ({
  context,
  serviceWorker,
}) => {
  await mockNetwork(context);
  const welcome = await welcomePage(context);
  const article = await openArticle(context);

  // Nothing is checked automatically before the first choice.
  await article.waitForTimeout(SETTLE_MS);
  expect(await badgeOf(serviceWorker, ARTICLE)).toBe('');

  // The welcome tab is in the background now; a DOM click needs no focus or animation frames.
  await welcome.getByRole('radio', { name: 'Automatic' }).dispatchEvent('click');
  await expect.poll(() => badgeOf(serviceWorker, ARTICLE)).toBe(BADGE);
  await expect(welcome.getByText('Saved')).toBeVisible();
  expect(await serviceWorker.evaluate(() => chrome.storage.local.get('onboarded'))).toEqual({
    onboarded: true,
  });
});

test('skips sites on the block list', async ({ context, serviceWorker }) => {
  const network = await mockNetwork(context);
  await prepare(context, serviceWorker, network, {
    siteFilter: { block: [...DEFAULT_BLOCK_LIST, 'xkcd.com'] },
  });
  const page = await openArticle(context);

  // Nothing to wait for when nothing happens: give the scheduler time to act, then look.
  await page.waitForTimeout(SETTLE_MS);
  expect(await badgeOf(serviceWorker, ARTICLE)).toBe('');
  expect(network.requests).toEqual([]);

  // Control: the same tab is checked once the site is no longer blocked.
  await serviceWorker.evaluate(() => chrome.storage.sync.set({ settings: {} }));
  await expect.poll(() => badgeOf(serviceWorker, ARTICLE)).toBe(BADGE);
});
