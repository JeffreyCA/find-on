import { describe, expect, it } from 'vitest';
import {
  fakeFetch,
  fixtureJson,
  fixtureText,
  html,
  json,
  oldRedditLoginWall,
  testEnv,
  type Route,
} from '../test-utils';
import type { Depth, SourceState } from '../types';
import { computeKeys, type UrlKeys } from '../url';
import {
  checkSignedIn,
  commentSearchUrl,
  lookupReddit,
  lookupRedditMentions,
  mentionTerm,
} from './reddit';
import { parseSearchIds } from './reddit-search';

const PAGE_URL = 'https://xkcd.com/927/';
const PAGE: UrlKeys = computeKeys(PAGE_URL) ?? expect.unreachable();
const EMPTY = { kind: 'Listing', data: { after: null, dist: 0, children: [], before: null } };

const tooMany = () =>
  new Response('', {
    status: 429,
    headers: { 'x-ratelimit-reset': '40', 'x-ratelimit-remaining': '0' },
  });
const odd = () => json({ kind: 'Listing', data: { posts: [] } });
const searchFixture = () => html(fixtureText('reddit-search-xkcd-927.html'));
const hydratedFixture = () => json(fixtureJson('reddit-search-xkcd-927.json'));
const infoFixture = () => json(fixtureJson('reddit-info-xkcd-927.json'));
const blockPage = () => html(fixtureText('reddit-blocked-403.html'), 403);

/** Search HTML, ID hydration and exact-URL lookups, all on the same host. */
function reddit(search: () => Response, info: () => Response, hydrate = hydratedFixture): Route {
  return (url) => {
    if (url.hostname === 'old.reddit.com' && url.pathname === '/search') return search();
    if (url.hostname === 'old.reddit.com' && url.pathname === '/api/info.json')
      return url.searchParams.has('id') ? hydrate() : info();
    throw new Error(`unexpected request ${url.href}`);
  };
}

function setup(route: Route) {
  const { fetch, calls } = fakeFetch(route);
  const env = testEnv(fetch);
  const run = async (depth: Depth, force = false) =>
    (
      await lookupReddit(PAGE, PAGE_URL, {
        depth,
        force,
        signal: new AbortController().signal,
        env,
        guard: env.guard,
      })
    ).state;
  const endpoints = () =>
    calls.map(({ url }) => `${url.hostname.split('.')[0]} ${url.pathname.replace(/\.json$/, '')}`);
  return { calls, env, run, endpoints };
}

function items(state: SourceState) {
  if (state.status !== 'ok') throw new Error(`expected ok, got ${state.status}`);
  return state.items;
}

describe('lookupReddit', () => {
  it('keeps matching posts, hides deleted and removed ones, and drops other pages', async () => {
    const { run, calls } = setup(reddit(searchFixture, () => json(EMPTY)));
    const found = items(await run('auto'));
    const byId = Object.fromEntries(found.map((d) => [d.id, d]));
    expect(Object.keys(byId).toSorted()).toEqual(
      ['110a8a3', '1wvy0pb', '3770g6', 'iuhzn', 'iuruu', 'zzsim1', 'zzxpost'].toSorted(),
    );
    // 980vg6: author [deleted]; z26zrd: removed by a moderator; 1vgbm9c: a self post;
    // zzother: xkcd.com/1927, another comic.
    expect(byId['zzsim1']?.tier).toBe('similar'); // m.xkcd.com
    expect(byId['iuhzn']).toEqual({
      source: 'reddit',
      id: 'iuhzn',
      title: expect.any(String),
      submittedUrl: 'http://xkcd.com/927/',
      venue: 'comics',
      author: 'ani625',
      points: 1042,
      comments: 168,
      createdAt: expect.any(Number),
      tier: 'exact',
      permalink: expect.stringMatching(/^\/r\/comics\/comments\/iuhzn\//),
      flags: ['archived'],
    });
    expect(byId['1wvy0pb']?.flags).toEqual(['nsfw']);
    expect(byId['zzxpost']?.crosspostOf).toBe('73b660');
    expect(calls.every(({ init }) => init?.credentials === 'include')).toBe(true);
    expect(
      calls.find(({ url }) => url.searchParams.has('id'))?.url.searchParams.get('id'),
    ).toContain('t3_iuhzn');
  });

  it('is ok, but incomplete, when one request fails and another answers', async () => {
    const { run, endpoints } = setup(
      reddit(searchFixture, () => new Response('', { status: 502 })),
    );
    const state = await run('auto');
    expect(state).toMatchObject({ status: 'ok', complete: false });
    expect(items(state).length).toBeGreaterThan(0);
    expect(endpoints()).toEqual(['old /search', 'old /api/info', 'old /api/info']);
  });

  it('accepts verified empty HTML without hydrating, but not an unrelated page', async () => {
    const empty = setup(
      reddit(
        () => html('<div class="search-result-listing"></div>'),
        () => json(EMPTY),
      ),
    );
    expect(await empty.run('auto')).toEqual({ status: 'ok', items: [], complete: true });
    expect(empty.calls).toHaveLength(2);
    const unrelated = setup(
      reddit(
        () => html('<form action="/login"></form>'),
        () => json(EMPTY),
      ),
    );
    expect(await unrelated.run('auto')).toMatchObject({ status: 'ok', complete: false });
  });

  it('hydrates only discovered IDs, in search order, and omits missing posts', async () => {
    const { run, calls } = setup(
      reddit(
        () =>
          html(`<div class="search-result-listing">
        <div class="search-result" data-fullname="t3_iuruu"></div>
        <div class="search-result" data-fullname="t3_absent"></div>
        <div class="search-result" data-fullname="t3_iuhzn"></div>
      </div>`),
        () => json(EMPTY),
      ),
    );
    expect(items(await run('auto')).map(({ id }) => id)).toEqual(['iuruu', 'iuhzn']);
    expect(calls.find(({ url }) => url.searchParams.has('id'))?.url.searchParams.get('id')).toBe(
      't3_iuruu,t3_absent,t3_iuhzn',
    );
  });

  it('preserves exact-URL results when ID hydration is blocked', async () => {
    const { run } = setup(reddit(searchFixture, infoFixture, blockPage));
    const state = await run('auto');
    expect(state).toMatchObject({ status: 'ok', complete: false, limited: true });
    expect(items(state).length).toBeGreaterThan(0);
  });

  it('reserves the extra hydration request in the automatic rate budget', async () => {
    const { run, calls } = setup(reddit(searchFixture, () => json(EMPTY)));
    expect((await run('auto')).status).toBe('ok');
    expect((await run('auto')).status).toBe('ok');
    expect(await run('auto')).toEqual({ status: 'deferred' });
    expect(calls).toHaveLength(6);
  });

  it('does not hydrate after the parallel exact-URL request hits a rate limit', async () => {
    const htmlResponse = Promise.withResolvers<Response>();
    const { run, calls } = setup((url) =>
      url.pathname === '/search' ? htmlResponse.promise : tooMany(),
    );
    const result = run('auto');
    // Let the exact-URL response finish before releasing the HTML response.
    await new Promise((resolve) => setTimeout(resolve, 0));
    htmlResponse.resolve(searchFixture());
    expect(await result).toMatchObject({ status: 'rate-limited' });
    expect(await run('auto')).toMatchObject({ status: 'rate-limited' });
    expect(calls).toHaveLength(2);
  });

  it('tries every exact spelling when Reddit blocks its search, then holds search back', async () => {
    const { run, calls, endpoints } = setup((url, init) =>
      url.pathname.startsWith('/duplicates/')
        ? json([EMPTY, EMPTY])
        : reddit(blockPage, infoFixture)(url, init),
    );
    const state = await run('full');
    expect(state).toMatchObject({ status: 'ok', complete: false, limited: true });
    expect(items(state).length).toBeGreaterThan(0);
    expect(endpoints()).toEqual([
      'old /search',
      ...Array.from({ length: 5 }, () => 'old /api/info'),
      'old /duplicates/1i0iq9e',
    ]);

    // Held back: an automatic lookup no longer asks, and still is not complete.
    calls.length = 0;
    expect(await run('auto')).toMatchObject({ complete: false, limited: true });
    expect(endpoints()).toEqual(['old /api/info']);

    // A forced lookup does ask.
    calls.length = 0;
    await run('auto', true);
    expect(endpoints()).toEqual(['old /search', 'old /api/info']);
  });

  it('fails like any other error when the exact-URL lookups are blocked too', async () => {
    const { run } = setup(reddit(blockPage, blockPage));
    expect(await run('full')).toMatchObject({ status: 'error', kind: 'format' });
  });

  it('is signed out when every request hits a sign-in wall, and pauses automatic lookups', async () => {
    const { run, calls } = setup(reddit(oldRedditLoginWall, oldRedditLoginWall));
    expect(await run('auto')).toEqual({ status: 'signed-out' });
    expect(await run('auto')).toMatchObject({ status: 'paused' });
    expect(calls).toHaveLength(2);
    // The popup's own lookup still tries (user intent).
    await run('full');
    expect(calls).toHaveLength(4);
  });

  it('reports 429 with the reset time and sends nothing more until then', async () => {
    const { run, calls, env } = setup(reddit(tooMany, tooMany));
    const retryAt = env.clock.now + 40_000;
    expect(await run('full')).toEqual({ status: 'rate-limited', retryAt });
    expect(await run('full')).toEqual({ status: 'rate-limited', retryAt });
    expect(calls).toHaveLength(2);
    await run('full', true);
    expect(calls).toHaveLength(4);
  });

  it('reports JSON without data.children as a format error', async () => {
    const { run } = setup(reddit(odd, odd));
    expect(await run('auto')).toMatchObject({ status: 'error', kind: 'format' });
  });
});

function mentions(route: Route) {
  const { fetch, calls } = fakeFetch(route);
  const env = testEnv(fetch);
  const run = () =>
    lookupRedditMentions(PAGE, {
      depth: 'full',
      force: false,
      signal: new AbortController().signal,
      env,
      guard: env.guard,
    });
  return { run, calls };
}

const termFor = (url: string) => mentionTerm(computeKeys(url) ?? expect.unreachable());

describe('lookupRedditMentions', () => {
  it('finds posts that link to the page in their text or title', async () => {
    const { run, calls } = mentions((url) =>
      url.pathname === '/search'
        ? html(fixtureText('reddit-mentions-xkcd-927.html'))
        : json(fixtureJson('reddit-mentions-xkcd-927.json')),
    );
    const state = await run();
    expect(calls).toHaveLength(2);
    const url = calls[0]?.url;
    expect(url?.hostname).toBe('old.reddit.com');
    expect(url?.searchParams.get('q')).toBe('"xkcd.com/927"');
    expect(calls[0]?.init?.credentials).toBe('include');
    // zzm3 links to xkcd.com/1927; zzm4 was removed. iuhzn is a discussion too; the popup leaves
    // it out.
    if (state.status !== 'ok') throw new Error(state.status);
    expect(state.items.map((m) => m.id)).toEqual(['zzm1', 'zzm2', 'iuhzn']);
    expect(state.items[1]).toEqual({
      source: 'reddit',
      id: 'zzm2',
      title: 'based off "xkcd: Standards" (https://xkcd.com/927/)',
      venue: 'DoctorWhumour',
      permalink: '/r/DoctorWhumour/comments/zzm2/slug/',
      post: {
        link: 'title',
        url: 'https://xkcd.com/927/',
        tier: 'exact',
        author: 'someone',
        points: 10,
        comments: 3,
        createdAt: 1_784_000_000_000,
      },
      inComments: 0,
      linkedAt: 1_784_000_000_000,
      flags: [],
    });
  });

  describe('parseSearchIds', () => {
    it('ignores promoted entries, sidebar posts, invalid IDs and script content, and dedupes', () => {
      expect(
        parseSearchIds(`
        <div class="thing" data-fullname="t3_sidebar"></div>
        <script><div class="search-result-listing"><div class="search-result" data-fullname="t3_script"></div></div></script>
        <div class="search-result-listing">
          <div class="search-result" data-fullname="t3_a"></div>
          <div class="search-result" data-fullname="t3_a"></div>
          <div data-promoted="true"><div class="search-result" data-fullname="t3_ad"></div></div>
          <div class="search-result" data-fullname="t5_subreddit"></div>
          <div class="search-result" data-fullname="t3_invalid,other"></div>
          <div class="search-result" data-fullname="t3_b"></div>
        </div>
      `),
      ).toEqual(['t3_a', 't3_b']);
      expect(
        parseSearchIds('<div id="siteTable"><div class="thing" data-fullname="t3_a"></div></div>'),
      ).toEqual(['t3_a']);
      expect(parseSearchIds('<div id="noresults"></div>')).toEqual([]);
      expect(
        parseSearchIds('<form><div class="thing" data-fullname="t3_a"></div></form>'),
      ).toBeNull();
    });
  });

  it('fails on a sign-in wall', async () => {
    expect(await mentions(oldRedditLoginWall).run()).toEqual({ status: 'failed' });
  });

  it('holds search back after a block page', async () => {
    const { run, calls } = mentions(blockPage);
    expect(await run()).toEqual({ status: 'failed', blocked: true });
    expect(await run()).toEqual({ status: 'failed', blocked: true });
    expect(calls).toHaveLength(1);
  });

  it('searches by content id where links come in several forms', () => {
    expect(termFor('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(termFor('https://arxiv.org/pdf/1706.03762v7')).toBe('1706.03762');
    expect(termFor('https://github.com/astral-sh/uv/tree/main')).toBe('github.com/astral-sh/uv');
    expect(commentSearchUrl(PAGE)).toBe(
      'https://www.reddit.com/search/?q=%22xkcd.com%2F927%22&type=comments',
    );
    const long = computeKeys(`https://example.com/${'a'.repeat(600)}`) ?? expect.unreachable();
    expect(commentSearchUrl(long)).toBeNull();
  });
});

function signedIn(route: Route) {
  const env = testEnv(fakeFetch(route).fetch);
  return checkSignedIn({ signal: new AbortController().signal, env, guard: env.guard });
}

describe('checkSignedIn', () => {
  it('does not depend on search', async () => {
    expect(await signedIn(reddit(blockPage, () => json(EMPTY)))).toBe(true);
    expect(await signedIn(reddit(blockPage, oldRedditLoginWall))).toBe(false);
    expect(await signedIn(reddit(blockPage, blockPage))).toBeNull();
  });
});
