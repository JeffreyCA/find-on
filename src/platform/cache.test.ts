import { describe, expect, it } from 'vitest';
import type { LookupResult, MentionState, SourceState } from '@/core/types';
import { canServe, type Want } from './cache';

const NOW = 1_760_000_000_000;
const ANSWERED: SourceState = { status: 'ok', items: [], complete: true };
const FOUND: MentionState = { status: 'ok', items: [], complete: true };

function result(mentions?: LookupResult['mentions'], noLink = false): LookupResult {
  return {
    key: '1:xkcd.com/927',
    page: {
      url: 'https://xkcd.com/927/',
      display: 'xkcd.com/927',
      ...(noLink && { noLink: { source: 'hn', id: '1' } }),
    },
    sources: { hn: ANSWERED, reddit: ANSWERED },
    depth: 'full',
    updatedAt: NOW,
    fetchedAt: NOW,
    ...(mentions && { mentions }),
  };
}

const want = (depth: Want['depth']): Want => ({
  depth,
  sources: { hn: true, reddit: true },
  incognito: false,
});

describe('canServe', () => {
  it('serves a popup lookup only once every answering source has its mentions', () => {
    expect(canServe(result({ hn: FOUND, reddit: FOUND }), want('full'), NOW)).toBe(true);
    const failed = result({ hn: { status: 'failed' }, reddit: FOUND });
    expect(canServe(failed, want('full'), NOW)).toBe(false);
    // Automatic lookups never need mentions.
    expect(canServe(failed, want('auto'), NOW)).toBe(true);
    // A text post has nothing to look up, mentions included.
    expect(canServe(result(undefined, true), want('full'), NOW)).toBe(true);
  });
});
