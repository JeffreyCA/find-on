import { describe, expect, it } from 'vitest';

import { checkEligibility, classifyHits, computeKeys, displayUrl, type UrlKeys } from './index';

function keys(url: string): UrlKeys {
  const k = computeKeys(url);
  if (!k) throw new Error(`no keys for ${url}`);
  return k;
}

describe('checkEligibility', () => {
  it.each([
    ['chrome://extensions', 'unsupported'],
    ['file:///Users/me/notes.txt', 'unsupported'],
    ['nonsense', 'invalid'],
    ['https://user:pass@example.com/', 'private'],
    ['http://localhost:3000/', 'private'],
    ['http://127.0.0.1/', 'private'],
    ['http://[::1]/', 'private'],
    ['http://intranet/wiki', 'private'],
    ['http://printer.local/', 'private'],
    ['https://grafana.internal/d/1', 'private'],
    // Wrappers are looked up as the URL they wrap.
    ['https://www.google.com/url?q=http://intranet.corp/secret', 'private'],
    ['https://web.archive.org/web/2020/http://192.168.1.10/admin', 'private'],
  ])('%s is %s', (url, reason) => {
    expect(checkEligibility(url)).toEqual({ ok: false, reason });
  });

  it('accepts public pages and removes fragments and secret-looking parameters', () => {
    expect(checkEligibility(' https://example.com/a?b=1&token=x&X-Amz-Signature=y#top ')).toEqual({
      ok: true,
      url: 'https://example.com/a?b=1',
    });
    expect(checkEligibility('https://app.example.com/#/item/42?code=abc&tab=2')).toEqual({
      ok: true,
      url: 'https://app.example.com/#/item/42?tab=2',
    });
  });
});

describe('computeKeys', () => {
  it('never puts secret-looking parameters in the SIMILAR key', () => {
    expect(keys('https://example.com/view?doc=1&access_token=abc').similar).toBe(
      'example.com/view?doc=1',
    );
  });
});

describe('classifyHits', () => {
  const page = [keys('https://example.com/library/show-paper?paperkey=1')];

  it('tags matches, drops other pages and keeps order', () => {
    const hits = [
      { id: 'a', url: 'https://example.com/elsewhere' },
      { id: 'b', url: 'http://www.example.com/library/show-paper?paperkey=1' },
      { id: 'c', url: 'https://example.com/library/show-paper?paperkey=1&ref=hn' },
    ];
    expect(classifyHits(hits, page)).toEqual([
      { id: 'b', url: hits[1]?.url, tier: 'exact' },
      { id: 'c', url: hits[2]?.url, tier: 'similar' },
    ]);
  });

  it('drops SIMILAR matches that span more than three different pages', () => {
    const hits = [1, 2, 3, 4, 5].map((n) => ({
      url: `https://example.com/library/show-paper?paperkey=${n}`,
    }));
    expect(classifyHits(hits, page).map((h) => h.tier)).toEqual(['exact']);
  });
});

describe('displayUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://en.wikipedia.org/wiki/Caf%C3%A9', 'en.wikipedia.org/wiki/Café'],
    // Reserved escapes and invisible or bidi characters stay encoded.
    ['https://example.com/a%2Fb', 'example.com/a%2Fb'],
    ['https://example.com/%E2%80%AEtxt', 'example.com/%E2%80%AEtxt'],
  ])('%s -> %s', (url, display) => {
    expect(displayUrl(keys(url))).toBe(display);
  });
});
