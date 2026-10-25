import { describe, expect, it } from 'vitest';
import { lookup } from './lookup';
import { fakeFetch, fixtureJson, json, testEnv, type Route } from './test-utils';
import type { Discussion, LookupResult } from './types';

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

function setup(route: Route = live) {
  const { fetch, calls } = fakeFetch(route);
  const run = (url: string) =>
    lookup(
      url,
      {
        depth: 'full',
        sources: { hn: true, reddit: true },
        incognito: false,
        signal: new AbortController().signal,
      },
      testEnv(fetch),
    );
  return { calls, run };
}

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
});
