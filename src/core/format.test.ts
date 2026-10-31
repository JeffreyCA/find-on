import { describe, expect, it } from 'vitest';
import { badgeText, compactNumber } from './format';
import type { Discussion, LookupResult, Mention, SourceState, Tier } from './types';

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
const mention = (id: string, comments?: number, tier: Tier = 'exact'): Mention => ({
  source: 'reddit',
  id,
  title: 't',
  venue: 'sub',
  permalink: `/r/sub/comments/${id}/t/`,
  ...(comments !== undefined && {
    post: {
      link: 'text',
      url: 'https://example.com/',
      tier,
      author: 'a',
      points: 1,
      comments,
      createdAt: 0,
    },
  }),
  inComments: 0,
  linkedAt: 0,
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
    expect(badgeText(r, 'discussions', false)).toBe('2');
    expect(badgeText(r, 'comments', false)).toBe('1.3k');
    // On a discussion page, that thread itself does not count.
    const thread: LookupResult = {
      ...r,
      page: { ...r.page, noLink: { source: 'reddit', id: 'same600' } },
    };
    expect(badgeText(thread, 'discussions', false)).toBe('1');
  });

  it('is empty when nothing counts, including failures and deferred Reddit lookups', () => {
    const r = result(
      { status: 'ok', items: [item('similar', 3)], complete: true },
      { status: 'deferred' },
    );
    expect(badgeText(r, 'discussions', false)).toBe('');
    expect(
      badgeText(result({ status: 'loading' }, { status: 'signed-out' }), 'comments', false),
    ).toBe('');
  });

  it('adds text posts while they are counted, but not other versions or threads already listed', () => {
    const r: LookupResult = {
      ...result(
        { status: 'ok', items: [], complete: true },
        { status: 'ok', items: [item('same', 600)], complete: true },
      ),
      mentions: {
        reddit: {
          status: 'ok',
          // A text post, one that links to another version, a discussion that is a mention too,
          // and a thread found through comments.
          items: [
            mention('post', 40),
            mention('other', 90, 'similar'),
            mention('same600', 600),
            mention('thread'),
          ],
        },
      },
    };
    expect(badgeText(r, 'discussions', false)).toBe('1');
    expect(badgeText(r, 'discussions', true)).toBe('2');
    expect(badgeText(r, 'comments', true)).toBe('640');
  });
});
