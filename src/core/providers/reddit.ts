// Reddit through the user's signed-in reddit.com session. Pure TS.
//
// The browser attaches the user's reddit.com cookies to these requests (`credentials: 'include'`).
// Every request goes to old.reddit.com: www.reddit.com answers JSON requests with a 403 "blocked by
// network security" page even for signed-in users. Signed out, old.reddit.com redirects to its login
// page. Search results are candidates only: every post is classified locally on
// `url_overridden_by_dest ?? url`, and posts in no tier are dropped.

import {
  failureState,
  getJson,
  REQUEST_TIMEOUT_MS,
  type Failure,
  type FetchPolicy,
  type HttpEnv,
} from '../http';
import type { RedditGuard } from '../rate-guard';
import {
  isRecord,
  type Depth,
  type Discussion,
  type DiscussionFlag,
  type SourceState,
  type Tier,
} from '../types';
import { classifyHits, computeKeys, redditVariants, splitIdentity, type UrlKeys } from '../url';
import { hasStrongMatch, numberOr0, stringOr, type OkState } from './common';

export const OLD_REDDIT = 'https://old.reddit.com';

/** Reddit search rejects longer queries; such pages rely on the exact-URL lookups instead. */
const MAX_SEARCH_QUERY = 512;
/** Variants of the page URL tried against /api/info.json (#1 always, #2 and #3 for `full`). */
const INFO_VARIANTS = 3;

/** Network errors, timeouts and 5xx are retried once for `full` and never for `auto`. */
export function redditPolicy(depth: Depth): FetchPolicy {
  return {
    credentials: 'include',
    timeoutMs: REQUEST_TIMEOUT_MS,
    retries: depth === 'full' ? 1 : 0,
    retryRateLimited: false,
  };
}

/** E: Reddit's exact-URL index. */
export function infoUrl(variant: string): string {
  return `${OLD_REDDIT}/api/info.json?url=${encodeURIComponent(variant)}&limit=100&raw_json=1`;
}

/** S: fuzzy `url:` search. */
export function searchUrl(query: string, limit = 100): string {
  return `${OLD_REDDIT}/search.json?q=${encodeURIComponent(`url:${query}`)}&sort=top&t=all&type=link&limit=${limit}&raw_json=1`;
}

/** D: the post, then the other submissions of the same link. */
export function duplicatesUrl(id: string): string {
  return `${OLD_REDDIT}/duplicates/${id}.json?limit=100&raw_json=1`;
}

/** T: one post by id (resolves a thread page to the URL it links to). */
export function postUrl(id: string): string {
  return `${OLD_REDDIT}/by_id/t3_${id}.json?raw_json=1`;
}

/**
 * The `url:` search term for a page: the SIMILAR key (no scheme), except for sites whose
 * content id matches more spellings than any URL form.
 */
export function searchQuery(keys: UrlKeys): string {
  const [kind, id] = splitIdentity(keys.identity);
  switch (kind) {
    case 'youtube':
      return `youtube.com/watch?v=${id}`;
    case 'twitter':
      return id;
    case 'arxiv':
      return `arxiv.org/abs/${id}`;
    case 'github':
      // The repository, also from its default-branch tree pages.
      return `github.com/${id}`;
    default:
      return keys.similar;
  }
}

/** The fields of a Reddit link (`t3`) we use. */
export interface RedditPost {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  num_comments: number;
  /** Epoch seconds. */
  created_utc: number;
  permalink: string;
  /** Candidate URL: `url_overridden_by_dest ?? url`, made absolute. */
  url: string;
  is_self: boolean;
  over_18: boolean;
  spoiler: boolean;
  locked: boolean;
  archived: boolean;
  /** Removed by moderators, admins or the author (`removed_by_category` is set). */
  removed: boolean;
  crosspost_parent?: string;
}

/**
 * Reads a Listing, or the array of Listings that /duplicates returns. Null when the body is not a
 * listing at all (no `data.children`); malformed children are skipped.
 */
export function parseListings(data: unknown): RedditPost[] | null {
  const listings = Array.isArray(data) ? data : [data];
  if (listings.length === 0) return null;
  const posts: RedditPost[] = [];
  for (const listing of listings) {
    if (!isRecord(listing) || !isRecord(listing['data'])) return null;
    const children = listing['data']['children'];
    if (!Array.isArray(children)) return null;
    for (const child of children) {
      if (!isRecord(child) || child['kind'] !== 't3') continue;
      const post = parsePost(child['data']);
      if (post) posts.push(post);
    }
  }
  return posts;
}

function parsePost(d: unknown): RedditPost | null {
  if (!isRecord(d)) return null;
  const id = d['id'];
  const permalink = d['permalink'];
  const rawUrl = stringOr(d['url_overridden_by_dest'], '') || stringOr(d['url'], '');
  if (typeof id !== 'string' || !/^[a-z0-9]+$/i.test(id) || typeof permalink !== 'string') {
    return null;
  }
  const url = absoluteUrl(rawUrl);
  if (!url) return null;
  const parent = d['crosspost_parent'];
  return {
    id,
    title: stringOr(d['title'], ''),
    subreddit: stringOr(d['subreddit'], ''),
    author: stringOr(d['author'], ''),
    score: numberOr0(d['score']),
    num_comments: numberOr0(d['num_comments']),
    created_utc: numberOr0(d['created_utc']),
    permalink,
    url,
    is_self: d['is_self'] === true,
    over_18: d['over_18'] === true,
    spoiler: d['spoiler'] === true,
    locked: d['locked'] === true,
    archived: d['archived'] === true,
    removed: d['removed_by_category'] !== null && d['removed_by_category'] !== undefined,
    ...(typeof parent === 'string' && { crosspost_parent: parent }),
  };
}

/** Crossposts of self posts carry a relative permalink as their URL. */
function absoluteUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    return new URL(raw, 'https://www.reddit.com').href;
  } catch {
    return null;
  }
}

/** Reddit asks clients to stop showing deleted and removed content. */
function isVisible(post: RedditPost): boolean {
  return !post.removed && post.author !== '[deleted]';
}

export function toDiscussion(post: RedditPost, tier: Tier): Discussion {
  const flags: DiscussionFlag[] = [];
  if (post.over_18) flags.push('nsfw');
  if (post.spoiler) flags.push('spoiler');
  if (post.locked) flags.push('locked');
  if (post.archived) flags.push('archived');
  const parent = post.crosspost_parent?.replace(/^t3_/, '');
  return {
    source: 'reddit',
    id: post.id,
    title: post.title,
    submittedUrl: post.url,
    venue: post.subreddit,
    author: post.author,
    points: post.score,
    comments: post.num_comments,
    createdAt: post.created_utc * 1000,
    tier,
    permalink: post.permalink,
    flags,
    ...(parent && { crosspostOf: parent }),
  };
}

/** Hides deleted and removed posts, dedupes by id, classifies, and drops posts in no tier. */
export function matchPosts(posts: readonly RedditPost[], page: UrlKeys): Discussion[] {
  const seen = new Set<string>();
  const unique = posts.filter((p) => {
    if (!isVisible(p) || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  return classifyHits(unique, [page]).map((p) => toDiscussion(p, p.tier));
}

export interface RedditContext {
  depth: Depth;
  /** User-initiated retry: skips the rate guard's bucket, pauses and breaker. */
  force: boolean;
  signal: AbortSignal;
  env: HttpEnv;
  guard: RedditGuard;
}

export interface RedditLookupOptions extends RedditContext {
  /**
   * Result of an earlier `auto` lookup of the same page; a `full` lookup continues its plan. Its
   * `complete` says whether S and E(#1) both answered; otherwise they are sent again.
   */
  previous?: OkState;
  /** Posts already fetched (the thread the user is on), matched along with the results. */
  seed?: readonly RedditPost[];
  /** The thread the page was resolved from: the duplicates request runs on it. */
  threadId?: string;
}

type Attempt = Failure | { kind: 'ok' };

export interface RedditLookup {
  state: SourceState;
  /**
   * The rate guard held back a `full` lookup that continues `previous`: `state` is that earlier
   * result, so this is still only an `auto` answer.
   */
  held?: true;
}

/**
 * Runs the Reddit request plan and merges the results into one source state.
 *
 * - `auto`: S and E(#1) in parallel.
 * - `full`: S and E(#1) in parallel (skipped when continuing an `auto` result in which both
 *   answered), then E(#2) and E(#3) one at a time while nothing SAME/EXACT is found, then D on the
 *   best SAME/EXACT post.
 *
 * A failed request (after its retry) stops the lookup: every request goes to the same host, and a
 * challenge, a 429 or a sign-in wall concerns the account. If any request succeeded the source is
 * `ok` with what was found, otherwise it takes the most specific failure.
 */
export async function lookupReddit(
  page: UrlKeys,
  pageUrl: string,
  opts: RedditLookupOptions,
): Promise<RedditLookup> {
  const { depth, force, guard, previous } = opts;
  const policy = redditPolicy(depth);
  const variants = redditVariants(pageUrl, INFO_VARIANTS);
  const query = searchQuery(page);
  const search = `url:${query}`.length <= MAX_SEARCH_QUERY ? searchUrl(query) : undefined;

  const attempts: Attempt[] = [];
  const posts: RedditPost[] = [...(opts.seed ?? [])];
  let stopped = false;

  const run = async (url: string): Promise<void> => {
    if (stopped) return;
    const outcome = await getJson(url, policy, opts.env, opts.signal);
    await guard.observe(outcome);
    if (outcome.kind === 'ok') {
      const parsed = parseListings(outcome.data);
      if (parsed) {
        posts.push(...parsed);
        attempts.push({ kind: 'ok' });
        return;
      }
      attempts.push({
        kind: 'format',
        detail: 'response without data.children',
        meta: outcome.meta,
      });
      stopped = true;
      return;
    }
    attempts.push(outcome);
    stopped = true;
  };

  // S and E(#1), unless an earlier result has both answers already (a failed request has none).
  const first: string[] = [];
  if (!previous?.complete) {
    if (search) first.push(search);
    if (variants[0]) first.push(infoUrl(variants[0]));
  }
  const admission = await guard.admit({ depth, force, cost: first.length });
  if (!admission.ok) return previous ? { state: previous, held: true } : { state: admission.state };
  await Promise.all(first.map((url) => run(url)));

  let items = mergeItems(previous?.items ?? [], matchPosts(posts, page));
  if (depth === 'full') {
    for (const variant of variants.slice(1)) {
      if (hasStrongMatch(items) || stopped) break;
      // oxlint-disable-next-line no-await-in-loop -- each variant is only tried if the last missed
      await run(infoUrl(variant));
      items = mergeItems(previous?.items ?? [], matchPosts(posts, page));
    }
    const target = opts.threadId ?? bestStrongMatch(items)?.id;
    if (target) {
      await run(duplicatesUrl(target));
      items = mergeItems(previous?.items ?? [], matchPosts(posts, page));
    }
  }

  const failures = attempts.filter((a): a is Failure => a.kind !== 'ok');
  const anyOk = attempts.some((a) => a.kind === 'ok');
  await guard.conclude({
    anyOk,
    signedOut: failures.some((f) => f.kind === 'login' || f.kind === 'blocked'),
    challenged: failures.some((f) => f.kind === 'challenge'),
  });

  if (anyOk || previous || attempts.length === 0) {
    // With nothing sent (no usable query or variant), the result is only what was seeded.
    const base = attempts.length > 0 || previous?.complete === true;
    return { state: { status: 'ok', items, complete: base && failures.length === 0 } };
  }
  return { state: mostSpecific(failures) };
}

/** signed-out > challenge > rate-limited > error. */
function mostSpecific(failures: readonly Failure[]): SourceState {
  const [best] = failures.toSorted((a, b) => failureRank(a) - failureRank(b));
  return best
    ? failureState(best, 'reddit')
    : { status: 'error', kind: 'format', detail: 'no response' };
}

function failureRank(f: Failure): number {
  if (f.kind === 'login' || f.kind === 'blocked') return 0;
  if (f.kind === 'challenge') return 1;
  return f.kind === 'rate-limited' ? 2 : 3;
}

/** Earlier items first; new items with an id already present are dropped. */
function mergeItems(earlier: readonly Discussion[], later: readonly Discussion[]): Discussion[] {
  const ids = new Set(earlier.map((d) => d.id));
  return [...earlier, ...later.filter((d) => !ids.has(d.id))];
}

function bestStrongMatch(items: readonly Discussion[]): Discussion | undefined {
  let best: Discussion | undefined;
  for (const d of items) {
    if (d.tier !== 'similar' && (!best || d.comments > best.comments)) best = d;
  }
  return best;
}

export type RedditThread =
  /** A link post: look up its URL. `post` is the thread itself, `thread` too if it may be shown. */
  | { kind: 'link'; url: string; post: RedditPost; thread?: Discussion }
  /** A self post (or a crosspost of one): the thread itself, if it may be shown. */
  | { kind: 'self'; thread?: Discussion }
  /** No such post. */
  | { kind: 'unknown' }
  /** The rate guard said no, or the request failed. */
  | { kind: 'failed'; state: SourceState };

/** Resolves a Reddit thread page to the URL it links to with one T request. */
export async function resolveRedditThread(id: string, ctx: RedditContext): Promise<RedditThread> {
  const { guard } = ctx;
  const admission = await guard.admit({ depth: ctx.depth, force: ctx.force, cost: 1 });
  if (!admission.ok) return { kind: 'failed', state: admission.state };
  const outcome = await getJson(postUrl(id), redditPolicy(ctx.depth), ctx.env, ctx.signal);
  await guard.observe(outcome);
  const posts = outcome.kind === 'ok' ? parseListings(outcome.data) : null;
  await guard.conclude({
    anyOk: posts !== null,
    signedOut: outcome.kind === 'login' || outcome.kind === 'blocked',
    challenged: outcome.kind === 'challenge',
  });
  if (outcome.kind !== 'ok') return { kind: 'failed', state: failureState(outcome, 'reddit') };
  if (!posts) {
    return {
      kind: 'failed',
      state: { status: 'error', kind: 'format', detail: 'response without data.children' },
    };
  }
  const post = posts.find((p) => p.id.toLowerCase() === id.toLowerCase());
  if (!post) return { kind: 'unknown' };
  const thread = isVisible(post) ? toDiscussion(post, 'same') : undefined;
  // A crosspost of a self post links to another thread.
  if (post.is_self || splitIdentity(computeKeys(post.url)?.identity)[0] === 'reddit') {
    return { kind: 'self', ...(thread && { thread }) };
  }
  return { kind: 'link', url: post.url, post, ...(thread && { thread }) };
}

/** One search request for a known URL: true when Reddit answers, false when it asks to sign in. */
export async function checkSignedIn(
  ctx: Omit<RedditContext, 'depth' | 'force'>,
): Promise<boolean | null> {
  const outcome = await getJson(
    searchUrl('xkcd.com/927', 1),
    redditPolicy('auto'),
    ctx.env,
    ctx.signal,
  );
  await ctx.guard.observe(outcome);
  const ok = outcome.kind === 'ok' && parseListings(outcome.data) !== null;
  const signedOut = outcome.kind === 'login' || outcome.kind === 'blocked';
  await ctx.guard.conclude({ anyOk: ok, signedOut, challenged: outcome.kind === 'challenge' });
  if (ok) return true;
  return signedOut ? false : null;
}
