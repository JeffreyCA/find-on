import { describe, expect, it } from 'vitest';
import {
  fakeFetch,
  fixtureJson,
  json,
  oldRedditLoginWall,
  testEnv,
  wwwRedditBlocked,
  type Route,
} from '../test-utils';
import type { Depth, SourceState } from '../types';
import { computeKeys, type UrlKeys } from '../url';
import { lookupReddit } from './reddit';

const PAGE_URL = 'https://xkcd.com/927/';
const PAGE: UrlKeys = computeKeys(PAGE_URL) ?? expect.unreachable();
const EMPTY = { kind: 'Listing', data: { after: null, dist: 0, children: [], before: null } };

const tooMany = () =>
  new Response('', {
    status: 429,
    headers: { 'x-ratelimit-reset': '40', 'x-ratelimit-remaining': '0' },
  });
const odd = () => json({ kind: 'Listing', data: { posts: [] } });
const searchFixture = () => json(fixtureJson('reddit-search-xkcd-927.json'));

/** Answers www.reddit.com search and old.reddit.com info; anything else fails the test. */
function reddit(search: () => Response, info: () => Response): Route {
  return (url) => {
    if (url.hostname === 'www.reddit.com' && url.pathname === '/search.json') return search();
    if (url.hostname === 'old.reddit.com' && url.pathname === '/api/info.json') return info();
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
    const { run } = setup(reddit(searchFixture, () => json(EMPTY)));
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
  });

  it('is ok when old.reddit.com walls but www.reddit.com answers, and skips old.reddit after', async () => {
    const { run, endpoints } = setup(reddit(searchFixture, oldRedditLoginWall));
    const state = await run('auto');
    expect(state).toMatchObject({ status: 'ok', complete: false });
    expect(items(state).length).toBeGreaterThan(0);
    await run('auto');
    expect(endpoints()).toEqual(['www /search', 'old /api/info', 'www /search']);
  });

  it('is signed out when every request hits a sign-in wall, and pauses automatic lookups', async () => {
    const { run, calls } = setup(reddit(wwwRedditBlocked, oldRedditLoginWall));
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
