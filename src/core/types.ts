// Shared contracts between core logic, the background service worker and the UI.
// Extend additively only.

export type SourceId = 'hn' | 'reddit';
export const SOURCE_IDS: readonly SourceId[] = ['hn', 'reddit'];
export type Tier = 'same' | 'exact' | 'similar';
export type Depth = 'auto' | 'full';
export type DiscussionFlag = 'nsfw' | 'spoiler' | 'locked' | 'archived';

export interface Discussion {
  source: SourceId;
  /** HN objectID or Reddit base36 id. */
  id: string;
  title: string;
  /** URL as submitted. */
  submittedUrl: string;
  /** Subreddit name without "r/" for Reddit; "" for HN. */
  venue: string;
  author: string;
  points: number;
  comments: number;
  /** Epoch ms. */
  createdAt: number;
  tier: Tier;
  /** HN: "/item?id=<id>", Reddit: "/r/<sub>/comments/<id>/<slug>/". */
  permalink: string;
  flags: DiscussionFlag[];
  crosspostOf?: string;
}

export type SourceState =
  /** Disabled in settings. */
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ok'; items: Discussion[]; complete: boolean }
  /** Reddit auto lookup skipped by the rate guard. */
  | { status: 'deferred' }
  /** Reddit only. */
  | { status: 'signed-out' }
  /** Reddit only. */
  | { status: 'challenge' }
  | { status: 'rate-limited'; retryAt: number }
  /** Reddit circuit breaker open (auto only). */
  | { status: 'paused'; retryAt: number }
  /**
   * Not asked: Reddit in a private window, or (automatic lookups only) a thread whose linked page is
   * on the blocklist.
   */
  | { status: 'skipped'; reason: 'incognito' | 'filtered' }
  | { status: 'error'; kind: 'network' | 'http' | 'format'; detail: string };

export interface PageInfo {
  /** URL actually looked up (after discussion-page resolution). */
  url: string;
  /** Short human form, e.g. "xkcd.com/927". */
  display: string;
  /** Set when the tab was a discussion page. */
  resolvedFrom?: { source: SourceId; id: string; url: string };
  /** Text/self post: nothing to look up. */
  noLink?: { source: SourceId; id: string };
}

export interface LookupResult {
  /** Cache key: `${RULES_VERSION}:${exactKey}`. */
  key: string;
  page: PageInfo;
  sources: Record<SourceId, SourceState>;
  depth: Depth;
  /** When this snapshot was written; orders the snapshots of one lookup. */
  updatedAt: number;
  /**
   * When the oldest data in it was fetched: a source reused from an earlier result keeps that
   * result's time, so reuse never extends the cache TTL.
   */
  fetchedAt: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
