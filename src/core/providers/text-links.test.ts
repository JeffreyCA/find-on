import { describe, expect, it } from 'vitest';
import { computeKeys } from '../url';
import { linkingItems, linksInHtml, urlsInText } from './text-links';

describe('linkingItems', () => {
  it('keeps the closest link of each item that links to the page', () => {
    const page = computeKeys('https://example.com/post') ?? expect.unreachable();
    const linking = linkingItems(
      [
        ['https://example.com/post?ref=hn', 'https://example.com/post/'],
        ['https://example.com/post/amp'],
        ['https://example.com/other'],
      ],
      page,
    );
    expect([...linking]).toEqual([
      [0, { url: 'https://example.com/post/', tier: 'exact' }],
      [1, { url: 'https://example.com/post/amp', tier: 'similar' }],
    ]);
  });
});

describe('linksInHtml', () => {
  it('reads hrefs and URLs written as text, never shortened link text', () => {
    expect(
      linksInHtml(
        '<p>See <a href="https:&#x2F;&#x2F;xkcd.com&#x2F;927&#x2F;" rel="nofollow">https:&#x2F;&#x2F;xkcd.com&#x2F;92...</a></p>',
      ),
    ).toEqual(['https://xkcd.com/927/']);
    expect(linksInHtml('<p>0: https:&#x2F;&#x2F;xkcd.com&#x2F;927&#x2F;<p>Next')).toEqual([
      'https://xkcd.com/927/',
    ]);
    expect(linksInHtml('<a href="https://e.com/a?x=1&amp;y=2">here</a>')).toEqual([
      'https://e.com/a?x=1&y=2',
    ]);
    // An href is exact: only a closing bracket with no opening one goes.
    expect(
      linksInHtml(
        '<a href="https://en.wikipedia.org/wiki/Sagittarius_A*">a</a> <a href="https://e.com/x)">b</a>',
      ),
    ).toEqual(['https://en.wikipedia.org/wiki/Sagittarius_A*', 'https://e.com/x']);
  });
});

describe('urlsInText', () => {
  it('finds URLs with or without a scheme, without the punctuation around them', () => {
    expect(urlsInText('based off "xkcd: Standards" (https://xkcd.com/927/)')).toEqual([
      'https://xkcd.com/927/',
    ]);
    expect(urlsInText('see xkcd.com/927.')).toEqual(['https://xkcd.com/927']);
    expect(urlsInText('https://en.wikipedia.org/wiki/Mercury_(planet), the planet')).toEqual([
      'https://en.wikipedia.org/wiki/Mercury_(planet)',
    ]);
    // A bare host, an email address or a file name with no path is no link.
    expect(urlsInText('xkcd.com, me@xkcd.com/927')).toEqual([]);
  });
});
