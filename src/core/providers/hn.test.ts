import { describe, expect, it } from 'vitest';
import { fakeFetch, fixtureJson, html, json, testEnv, type Route } from '../test-utils';
import { computeKeys, type UrlKeys } from '../url';
import { hnQuery, lookupHn, lookupHnMentions, type HnContext } from './hn';

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

  it('splits mention queries at brackets and escapes, which comments write either way', () => {
    const page = keys('https://en.wikipedia.org/wiki/Go_(programming_language)');
    expect(hnQuery(page, { mention: true }).query).toBe(
      'wikipedia.org en wiki go programming language',
    );
    const mentionQuery = (url: string) => hnQuery(keys(url), { mention: true }).query;
    // A word glued to an escape or an apostrophe is indexed with it ("27s"), so it goes.
    expect(mentionQuery('https://en.wikipedia.org/wiki/Goodhart%27s_law')).toBe(
      'wikipedia.org en wiki goodhart law',
    );
    expect(mentionQuery("https://en.wikipedia.org/wiki/Goodhart's_law")).toBe(
      'wikipedia.org en wiki goodhart law',
    );
    // A one-letter word never ends the query, which Algolia would match as a prefix.
    expect(mentionQuery('https://en.wikipedia.org/wiki/Star_Wars:_Episode_I')).toBe(
      'wikipedia.org en wiki star wars i episode',
    );
    expect(mentionQuery('https://en.wikipedia.org/wiki/C%2B%2B')).toBe(
      'wikipedia.org en wiki c%2b%2b',
    );
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

/** A linking comment hit, as the mention search returns it. */
function linkingComment(id: number, story: number, at: number) {
  return {
    _tags: ['comment', `story_${story}`],
    story_id: story,
    story_title: `Thread ${story}`,
    comment_text: '<p>https:&#x2F;&#x2F;xkcd.com&#x2F;927</p>',
    created_at_i: at,
    objectID: String(id),
  };
}

describe('lookupHnMentions', () => {
  it('finds comments and text posts that link to the page, by thread', async () => {
    const { opts, calls } = ctx(() => json(fixtureJson('hn-mentions-xkcd-927.json')));
    const state = await lookupHnMentions(keys('https://xkcd.com/927/'), opts);
    expect(calls).toHaveLength(1);
    if (state.status !== 'ok') throw new Error(state.status);
    // Thread B links to xkcd.com/1927. 2784984 is a discussion too; the popup leaves it out.
    expect(state.items.map((m) => m.id)).toEqual(['90000001', '90000002', '2784984']);
    expect(state.items[0]).toEqual({
      source: 'hn',
      id: '90000001',
      title: 'Thread A',
      venue: '',
      permalink: '/item?id=90000001',
      inComments: 2,
      commentId: '90000004',
      linkedAt: 1_759_900_000_000,
      flags: [],
    });
    // A text post carries its own details, and opens at the post even with a linking comment too.
    expect(state.items[1]).toMatchObject({
      post: {
        link: 'text',
        author: 'carol',
        points: 53,
        comments: 12,
        createdAt: 1_759_700_000_000,
      },
      inComments: 1,
      linkedAt: 1_759_750_000_000,
    });
    expect(state.items[1]?.commentId).toBeUndefined();
  });

  it('widens a first page with few threads', async () => {
    const { opts, calls } = ctx((url) =>
      url.searchParams.get('hitsPerPage') === '100'
        ? json({ nbHits: 2, hits: [linkingComment(1, 10, 2000)] })
        : json({ nbHits: 2, hits: [linkingComment(1, 10, 2000), linkingComment(2, 20, 1000)] }),
    );
    const state = await lookupHnMentions(keys('https://xkcd.com/927/'), opts);
    expect(calls.map((c) => c.url.searchParams.get('hitsPerPage'))).toEqual(['100', '1000']);
    if (state.status !== 'ok') throw new Error(state.status);
    expect(state.items.map((m) => m.id)).toEqual(['10', '20']);
  });
});
