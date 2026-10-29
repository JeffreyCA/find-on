import { describe, expect, it } from 'vitest';
import { lookup } from './lookup';
import { fakeFetch, fixtureJson, fixtureText, html, json, testEnv, type Route } from './test-utils';
import type { Depth, Discussion, LookupResult } from './types';

/** HN search and the Reddit endpoints, answered with recorded responses for xkcd.com/927. */
const live: Route = (url) => {
  if (url.hostname === 'hn.algolia.com') {
    const recorded = url.searchParams.get('query') === 'xkcd.com 927';
    return json(recorded ? fixtureJson('hn-search-xkcd-927.json') : { hits: [], nbHits: 0 });
  }
  if (url.pathname === '/search.json') return json(fixtureJson('reddit-search-xkcd-927.json'));
  if (url.pathname === '/api/info.json') return json(fixtureJson('reddit-info-xkcd-927.json'));
  if (url.pathname.startsWith('/duplicates/'))
    return json(fixtureJson('reddit-duplicates-1i0iq9e.json'));
  if (url.pathname === '/by_id/t3_1i0iq9e.json')
    return json(fixtureJson('reddit-by-id-1i0iq9e.json'));
  throw new Error(`unexpected request ${url.href}`);
};

function setup(route: Route = live, { textPosts = false } = {}) {
  const { fetch, calls } = fakeFetch(route);
  const env = testEnv(fetch);
  const run = (url: string, depth: Depth = 'full', previous?: LookupResult) =>
    lookup(
      url,
      {
        depth,
        sources: { hn: true, reddit: true },
        incognito: false,
        textPosts,
        signal: new AbortController().signal,
        ...(previous && { previous }),
      },
      env,
    );
  return { calls, run };
}

/** Requests for mentions: HN's date-sorted search and Reddit's quoted search. */
const isMentionSearch = (url: URL) =>
  url.pathname === '/api/v1/search_by_date' ||
  (url.pathname === '/search.json' && url.searchParams.get('q')?.startsWith('"') === true);

function ok(r: LookupResult, source: 'hn' | 'reddit'): Discussion[] {
  const state = r.sources[source];
  if (state.status !== 'ok') throw new Error(`${source}: ${state.status}`);
  return state.items;
}

describe('lookup', () => {
  it('keeps sources independent: one failing never blocks the other', async () => {
    const { run } = setup((url, init) =>
      url.hostname === 'hn.algolia.com'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : live(url, init),
    );
    const result = await run('https://xkcd.com/927/');
    expect(result.sources.hn).toEqual({
      status: 'error',
      kind: 'network',
      detail: 'Failed to fetch',
    });
    expect(ok(result, 'reddit').length).toBeGreaterThan(0);
    // No mention search follows a failed source.
    expect(result.mentions?.hn).toBeUndefined();
  });

  it('looks up mentions on full lookups, and on automatic ones while text posts count', async () => {
    const full = setup();
    const result = await full.run('https://xkcd.com/927/');
    expect(full.calls.filter((c) => isMentionSearch(c.url))).toHaveLength(2);
    const none = { status: 'ok', items: [] };
    expect(result.mentions).toEqual({ hn: none, reddit: none });

    const auto = setup();
    expect((await auto.run('https://xkcd.com/927/', 'auto')).mentions).toBeUndefined();
    expect(auto.calls.filter((c) => isMentionSearch(c.url))).toEqual([]);

    const counted = setup(live, { textPosts: true });
    const found = await counted.run('https://xkcd.com/927/', 'auto');
    expect(found.mentions).toEqual({ hn: none, reddit: none });
  });

  it('holds back the Reddit mention search while the account is challenged', async () => {
    const { run, calls } = setup((url, init) =>
      url.pathname.startsWith('/duplicates/')
        ? html(fixtureText('reddit-challenge.html'))
        : live(url, init),
    );
    const result = await run('https://xkcd.com/927/');
    expect(result.sources.reddit).toMatchObject({ status: 'ok', complete: false });
    // The challenge opened the breaker: the note counts down to when Reddit can be asked again.
    expect(result.mentions?.reddit).toEqual({ status: 'failed', retryAt: expect.any(Number) });
    expect(
      calls.filter((c) => c.url.hostname === 'old.reddit.com' && isMentionSearch(c.url)),
    ).toEqual([]);
  });

  it('sends Reddit no mention search once a request in its plan failed', async () => {
    const { run, calls } = setup((url, init) =>
      url.pathname.startsWith('/duplicates/') ? new Response('', { status: 500 }) : live(url, init),
    );
    const result = await run('https://xkcd.com/927/');
    expect(result.sources.reddit).toMatchObject({ status: 'ok', complete: false });
    expect(result.mentions?.reddit).toEqual({ status: 'failed' });
    expect(
      calls.filter((c) => c.url.hostname === 'old.reddit.com' && isMentionSearch(c.url)),
    ).toEqual([]);
  });

  it('asks again only for mentions that failed', async () => {
    let fail = true;
    const { run, calls } = setup((url, init) =>
      fail && url.pathname === '/api/v1/search_by_date'
        ? new Response('', { status: 502 })
        : live(url, init),
    );
    const first = await run('https://xkcd.com/927/');
    expect(first.mentions?.hn).toEqual({ status: 'failed' });

    fail = false;
    calls.length = 0;
    const second = await run('https://xkcd.com/927/', 'full', first);
    expect(calls.map((c) => c.url.pathname)).toEqual(['/api/v1/search_by_date']);
    expect(second.mentions?.hn?.status).toBe('ok');
    expect(second.mentions?.reddit).toEqual(first.mentions?.reddit);
  });

  it("leaves Reddit's front page to HN", async () => {
    const { run, calls } = setup();
    const result = await run('https://old.reddit.com/');
    expect(result.sources.reddit).toEqual({ status: 'skipped', reason: 'unsupported' });
    expect(calls.filter((c) => c.url.hostname === 'old.reddit.com')).toEqual([]);
    expect(result.sources.hn.status).toBe('ok');
    expect(Object.keys(result.mentions ?? {})).toEqual(['hn']);
  });

  it('looks up the URL a Reddit thread links to, and its other submissions', async () => {
    const { run, calls } = setup();
    const tab = 'https://www.reddit.com/r/ultimate/comments/1i0iq9e/regarding_club_team/';
    const result = await run(tab);
    expect(result.page).toMatchObject({
      url: 'https://xkcd.com/927/',
      resolvedFrom: { source: 'reddit', id: '1i0iq9e', url: tab },
    });
    expect(calls.map((c) => c.url.pathname)).toContain('/duplicates/1i0iq9e.json');
    expect(ok(result, 'reddit').map((d) => d.id)).toContain('1i0iq9e');
    expect(ok(result, 'hn')).toHaveLength(6);
  });

  it('tells a link post to another Reddit thread from a text post', async () => {
    const bestof = {
      kind: 'Listing',
      data: {
        children: [
          {
            kind: 't3',
            data: {
              id: 'zzbest',
              title: 'u/someone explains why standards proliferate',
              subreddit: 'bestof',
              author: 'poster',
              permalink: '/r/bestof/comments/zzbest/slug/',
              url: 'https://www.reddit.com/r/AskReddit/comments/abc123/slug/def456/',
              is_self: false,
            },
          },
        ],
      },
    };
    const { run, calls } = setup(() => json(bestof));
    const result = await run('https://www.reddit.com/r/bestof/comments/zzbest/slug/');
    expect(result.page.noLink).toEqual({ source: 'reddit', id: 'zzbest', linkPost: true });
    // Nothing else is looked up.
    expect(calls.map((c) => c.url.pathname)).toEqual(['/by_id/t3_zzbest.json']);
  });

  it('does not send a blocked page a thread links to (automatic lookups)', async () => {
    const { fetch, calls } = fakeFetch(live);
    const result = await lookup(
      'https://www.reddit.com/r/ultimate/comments/1i0iq9e/regarding_club_team/',
      {
        depth: 'auto',
        sources: { hn: true, reddit: true },
        incognito: false,
        signal: new AbortController().signal,
        isBlocked: (url) => new URL(url).hostname === 'xkcd.com',
      },
      testEnv(fetch),
    );
    const skipped = { status: 'skipped', reason: 'filtered' };
    expect(result.sources).toEqual({ hn: skipped, reddit: skipped });
    // Only the thread itself was fetched.
    expect(calls.map((c) => c.url.pathname)).toEqual(['/by_id/t3_1i0iq9e.json']);
  });
});
