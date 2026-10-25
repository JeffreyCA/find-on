import { describe, expect, it } from 'vitest';
import { badgeText, compactNumber } from './format';
import type { Discussion, LookupResult, SourceState } from './types';

describe('compactNumber', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1k'],
    [1999, '1.9k'],
    [12_345, '12k'],
    [999_999, '999k'],
    [1_234_567, '1.2M'],
    [2_500_000_000, '2.5B'],
  ])('%d -> %s', (n, text) => {
    expect(compactNumber(n)).toBe(text);
    expect(text.length).toBeLessThanOrEqual(4);
  });

  it('handles negative scores and fractions', () => {
    expect(compactNumber(-5)).toBe('-5');
    expect(compactNumber(12.9)).toBe('12');
  });
});

const item = (tier: Discussion['tier'], comments: number): Discussion => ({
  source: 'reddit',
  id: `${tier}${comments}`,
  title: 't',
  submittedUrl: 'https://example.com/',
  venue: 'sub',
  author: 'a',
  points: 1,
  comments,
  createdAt: 0,
  tier,
  permalink: '/r/sub/comments/x/t/',
  flags: [],
});
const result = (hn: SourceState, reddit: SourceState): LookupResult => ({
  key: 'k',
  page: { url: 'https://example.com/', display: 'example.com' },
  sources: { hn, reddit },
  depth: 'auto',
  updatedAt: 0,
  fetchedAt: 0,
});

describe('badgeText', () => {
  it('counts SAME and EXACT discussions or their comments, never SIMILAR', () => {
    const r = result(
      { status: 'ok', items: [item('exact', 700), item('similar', 5000)], complete: true },
      { status: 'ok', items: [item('same', 600)], complete: true },
    );
    expect(badgeText(r, 'discussions')).toBe('2');
    expect(badgeText(r, 'comments')).toBe('1.3k');
    // On a discussion page, that thread itself does not count.
    const thread: LookupResult = {
      ...r,
      page: { ...r.page, noLink: { source: 'reddit', id: 'same600' } },
    };
    expect(badgeText(thread, 'discussions')).toBe('1');
  });

  it('is empty when nothing counts, including failures and deferred Reddit lookups', () => {
    const r = result(
      { status: 'ok', items: [item('similar', 3)], complete: true },
      { status: 'deferred' },
    );
    expect(badgeText(r, 'discussions')).toBe('');
    expect(badgeText(result({ status: 'loading' }, { status: 'signed-out' }), 'comments')).toBe('');
  });
});
