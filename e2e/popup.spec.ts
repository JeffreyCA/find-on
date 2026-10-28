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
    (route) => {
      // Mentions: comments and text posts that link to the page, newest first.
      const { pathname } = new URL(route.request().url());
      const name =
        pathname === '/api/v1/search_by_date'
          ? 'hn-mentions-xkcd-927.json'
          : 'hn-search-xkcd-927.json';
      return fulfillJson(route, fixture(name));
    },
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
      const { pathname, searchParams } = new URL(route.request().url());
      // Mentions: a quoted search for the page in post text and titles.
      if (pathname === '/search.json' && searchParams.get('q')?.startsWith('"') === true)
        return fulfillJson(route, fixture('reddit-mentions-xkcd-927.json'));
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

  // Counts from the fixtures: 6 on HN, 9 on Reddit (search and old.reddit's exact index together),
  // plus the text posts that link to the page: 1 on HN, 2 on Reddit.
  await expect(popup.getByRole('radio', { name: 'All 18' })).toBeChecked();
  await expect(popup.getByRole('radio', { name: 'HN 7' })).toBeVisible();
  await expect(popup.getByRole('radio', { name: 'Reddit 11' })).toBeVisible();
  const rows = popup.getByRole('list', { name: 'Discussions' }).getByRole('link');
  // Most points first; the first row's name is its title and its score (upvotes on Reddit).
  await expect(rows.first()).toHaveAccessibleName('xkcd: Standards 1,042 upvotes');
  await expect(rows.first()).toHaveAttribute('href', /^https:\/\/www\.reddit\.com\/r\/comics\//);
  await expect(popup.getByRole('button', { name: '+6 more without comments' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Other versions 1' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  // Showing only Hacker News (the filter is a radio group: arrow keys move the choice).
  await popup.getByRole('radio', { name: 'All 18' }).focus();
  await popup.keyboard.press('ArrowRight');
  await expect(popup.getByRole('radio', { name: 'HN 7' })).toBeChecked();
  await expect(rows.first()).toHaveAttribute(
    'href',
    /^https:\/\/news\.ycombinator\.com\/item\?id=/,
  );
});

test('lists threads that link to the page', async ({ context, serviceWorker, extensionId }) => {
  await mockNetwork(context);
  await confirmOnboarding(serviceWorker);
  const popup = await openPopup(context, extensionId, ARTICLE);

  // Two of the mentions are discussions as well, and the three text posts are listed with the
  // discussions, so the group holds the one thread found through comments.
  await expect(popup.getByRole('button', { name: 'Mentioned in comments 1' })).toBeVisible();

  // With "Text posts" off they are mentions again, and the counts are the discussions' alone.
  await popup.getByRole('button', { name: 'Text posts' }).click();
  await expect(popup.getByRole('radio', { name: 'All 15' })).toBeChecked();
  const head = popup.getByRole('button', { name: 'Mentioned in posts and comments 4' });
  await head.click();
  const rows = popup
    .getByRole('region', { name: 'Mentioned in posts and comments' })
    .getByRole('link');
  await expect(rows).toHaveCount(4);
  // Most points first; a thread found only through comments has no numbers and comes last.
  await expect(rows.first()).toHaveAccessibleName(
    'Ask HN: Will there always be competing standards? 53 points',
  );
  await expect(rows.last()).toHaveAccessibleName('Thread A');
  // A thread whose comments link to the page opens at the newest of them.
  await expect(popup.getByRole('link', { name: 'Thread A', exact: true })).toHaveAttribute(
    'href',
    'https://news.ycombinator.com/item?id=90000001#90000004',
  );
  await expect(popup.getByRole('link', { name: 'Search Reddit comments' })).toHaveAttribute(
    'href',
    'https://www.reddit.com/search/?q=%22xkcd.com%2F927%22&type=comments',
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
  // Hacker News results still show, with its text post (the zero-comment rows are folded).
  await expect(popup.getByText('7 on HN')).toBeVisible();
  await expect(popup.getByRole('list', { name: 'Discussions' }).getByRole('link')).toHaveCount(2);
});
