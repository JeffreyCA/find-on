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

/**
 * A thread that links to the page from a comment, or from its post's text or title. Its own URL is
 * never read, so it may also be a submission of the page; the popup leaves out threads it lists.
 */
export interface Mention {
  source: SourceId;
  /** The thread: HN story objectID or Reddit base36 post id. */
  id: string;
  title: string;
  /** Subreddit name without "r/" for Reddit; "" for HN. */
  venue: string;
  /** As in Discussion. */
  permalink: string;
  /**
   * The post itself, when it links to the page. A thread found only through its comments has none:
   * HN's comment search does not return the thread's own details.
   */
  post?: MentionPost;
  /** HN comments in the thread that link to the page, among those fetched; 0 on Reddit. */
  inComments: number;
  /** HN only: the newest of those comments, to open the thread at. Set only without `post`. */
  commentId?: string;
  /** When the newest linking comment or post was written, epoch ms. */
  linkedAt: number;
  flags: DiscussionFlag[];
}

/** A post that links to the page: the popup can list it with the discussions. */
export interface MentionPost {
  /** Where: its text (HN or Reddit), or only its title (Reddit). */
  link: 'text' | 'title';
  author: string;
  points: number;
  comments: number;
  /** Epoch ms. */
  createdAt: number;
}

export type MentionState =
  | { status: 'loading' }
  /** `complete` is false when more candidates exist than were fetched. */
  | { status: 'ok'; items: Mention[]; complete: boolean }
  /**
   * The search failed, or the Reddit rate guard held it back (`retryAt`: when Reddit can be asked
   * again, after a 429, a pause or the breaker). The next popup lookup asks again.
   */
  | { status: 'failed'; retryAt?: number };

export interface PageInfo {
  /** URL actually looked up (after discussion-page resolution). */
  url: string;
  /** Short human form, e.g. "xkcd.com/927". */
  display: string;
  /** Set when the tab was a discussion page. */
  resolvedFrom?: { source: SourceId; id: string; url: string };
  /**
   * Nothing to look up: a text/self post, or (`linkPost`) a link post whose link can't be looked up
   * (another Reddit thread, a private address).
   */
  noLink?: { source: SourceId; id: string; linkPost?: true };
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
  /**
   * Threads that link to the page, per source. Only `full` lookups search for them, and only on a
   * source whose discussions answered `ok`; they never count toward the badge. A source is absent
   * when it was not asked.
   */
  mentions?: Partial<Record<SourceId, MentionState>>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
