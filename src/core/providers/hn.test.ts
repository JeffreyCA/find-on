import { describe, expect, it } from 'vitest';
import { fakeFetch, fixtureJson, html, json, testEnv, type Route } from '../test-utils';
import { computeKeys, type UrlKeys } from '../url';
import { hnQuery, lookupHn, type HnContext } from './hn';

function keys(url: string): UrlKeys {
  const k = computeKeys(url);
  if (!k) throw new Error(`no keys for ${url}`);
  return k;
}

/** Answers HN searches by query text; anything else is a 404. */
function algolia(byQuery: Record<string, unknown>): Route {
  return (url) => {
    const body = byQuery[url.searchParams.get('query') ?? ''];
    return body === undefined ? json({ message: 'unexpected query' }, 404) : json(body);
  };
}

function ctx(route: Route, depth: HnContext['depth'] = 'full') {
  const { fetch, calls } = fakeFetch(route);
  return { opts: { depth, signal: new AbortController().signal, env: testEnv(fetch) }, calls };
}

const queryFor = (url: string) => hnQuery(keys(url)).query;

const badGateway: Route = () => html('<p>Bad gateway</p>', 502);

describe('hnQuery', () => {
  it('uses host and path words, never scheme, www, query or fragment', () => {
    expect(queryFor('https://xkcd.com/927/')).toBe('xkcd.com 927');
    expect(queryFor('https://www.paulgraham.com/greatwork.html?utm_source=x#top')).toBe(
      'paulgraham.com greatwork.html',
    );
    expect(queryFor('https://www.bbc.co.uk/news/articles/c0k3l1l6x0lo')).toBe(
      'bbc.co.uk news articles c0k3l1l6x0lo',
    );
    expect(queryFor('https://example.com/blog/index.html')).toBe('example.com blog');
    // Encoded segments keep their ASCII pieces, or else stay whole (as HN stores them).
    expect(queryFor('https://en.wikipedia.org/wiki/Kurt_G%C3%B6del')).toBe(
      'wikipedia.org en wiki kurt',
    );
    expect(queryFor('https://en.wikipedia.org/wiki/Flâneur')).toBe(
      'wikipedia.org en wiki fl%c3%a2neur',
    );
  });

  it('queries identity sites by their id, last', () => {
    expect(queryFor('https://www.youtube.com/watch?v=-BP7DhHTU-I&t=42')).toBe('-BP7DhHTU-I');
    expect(queryFor('https://arxiv.org/pdf/1706.03762v7')).toBe('arxiv.org 1706.03762');
    expect(queryFor('https://mobile.twitter.com/jack/status/20?s=21')).toBe('20');
    expect(queryFor('https://github.com/torvalds/linux/tree/master')).toBe(
      'github.com torvalds linux',
    );
    expect(
      queryFor(
        'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster',
      ),
    ).toBe('stackoverflow.com questions 11227809');
  });

  it('keeps identifier values for escalation, never tracking or secrets', () => {
    expect(
      hnQuery(keys('https://bugzilla.mozilla.org/show_bug.cgi?id=1234567&utm_source=x')),
    ).toEqual({
      query: 'mozilla.org bugzilla show_bug.cgi',
      idValues: ['1234567'],
    });
    expect(hnQuery(keys('https://example.com/view?doc=1&access_token=abc')).idValues).toEqual([
      '1',
    ]);
  });
});

describe('lookupHn (recorded responses)', () => {
  it('keeps the page and drops unrelated candidates', async () => {
    const { opts, calls } = ctx(
      algolia({ 'example.com': fixtureJson('hn-search-example-root.json') }),
    );
    const state = await lookupHn(keys('https://example.com/'), opts);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.credentials).toBe('omit');
    if (state.status !== 'ok') throw new Error(state.status);
    expect(state.complete).toBe(true);
    // 15 of the 48 candidates: the root in every spelling, plus Wayback and AMP-viewer wrappers.
    // systemd-by-example.com, www.example.com/another, zty.pe/?url=... are other pages.
    expect(state.items).toHaveLength(15);
    expect(state.items.every((d) => d.tier === 'exact')).toBe(true);
    const urls = state.items.map((d) => d.submittedUrl);
    expect(urls).toContain('https://web.archive.org/web/20251001001217/https://example.com/');
    expect(urls).toContain('https://www.google.com/amp/example.com');
    expect(urls).not.toContain('https://systemd-by-example.com/');
    expect(urls).not.toContain('https://www.example.com/another');
    expect(urls).not.toContain('https://zty.pe/?url=https://example.com');
  });

  it('maps hits to discussions', async () => {
    const { opts } = ctx(
      algolia({
        'paulgraham.com greatwork.html': fixtureJson('hn-search-paulgraham-greatwork.json'),
      }),
    );
    const state = await lookupHn(keys('https://paulgraham.com/greatwork.html'), opts);
    if (state.status !== 'ok') throw new Error(state.status);
    expect(state.items.find((d) => d.id === '36550615')).toEqual({
      source: 'hn',
      id: '36550615',
      title: 'How to Do Great Work',
      submittedUrl: 'http://paulgraham.com/greatwork.html',
      venue: '',
      author: 'razin',
      points: 1008,
      comments: 432,
      createdAt: 1_688_222_516_000,
      tier: 'exact',
      permalink: '/item?id=36550615',
      flags: [],
    });
  });
});

describe('lookupHn failures', () => {
  it('retries twice for full and once for auto, then reports the error', async () => {
    const full = ctx(badGateway, 'full');
    expect(await lookupHn(keys('https://xkcd.com/927/'), full.opts)).toMatchObject({
      status: 'error',
      kind: 'http',
    });
    expect(full.calls).toHaveLength(3);
    const auto = ctx(badGateway, 'auto');
    await lookupHn(keys('https://xkcd.com/927/'), auto.opts);
    expect(auto.calls).toHaveLength(2);
  });

  it('reports an unexpected body as a format error', async () => {
    const { opts } = ctx(() => json({ results: [] }));
    expect(await lookupHn(keys('https://xkcd.com/927/'), opts)).toMatchObject({
      status: 'error',
      kind: 'format',
    });
  });
});
