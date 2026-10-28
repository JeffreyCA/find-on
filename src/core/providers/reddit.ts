// Reddit through the user's signed-in reddit.com session. Pure TS.
//
// The browser attaches the user's reddit.com cookies to these requests (`credentials: 'include'`).
// Every request goes to old.reddit.com: www.reddit.com answers JSON requests with a 403 "blocked by
// network security" page even for signed-in users. Signed out, old.reddit.com redirects to its login
// page. Search results are candidates only: every post is classified locally on
// `url_overridden_by_dest ?? url`, and posts in no tier are dropped. Mentions (posts that link to the
// page in their text or title) are verified the same way, on the links in that text.

import {
  failureState,
  getJson,
  REQUEST_TIMEOUT_MS,
  type Failure,
  type FetchPolicy,
  type HttpEnv,
  type HttpOutcome,
} from '../http';
import { redditOrigin } from '../links';
import type { RedditGuard } from '../rate-guard';
import {
  isRecord,
  type Depth,
  type Discussion,
  type DiscussionFlag,
  type Mention,
  type MentionState,
  type SourceState,
  type Tier,
} from '../types';
import { classifyHits, computeKeys, redditVariants, splitIdentity, type UrlKeys } from '../url';
import { hasStrongMatch, numberOr0, stringOr, type OkState } from './common';
import { linkingItems, linksInHtml, urlsInText } from './text-links';

export const OLD_REDDIT = redditOrigin('old');

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
  /** The post's text as HTML (raw, with `raw_json=1`), when it has any. */
  selftext_html?: string;
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
  const body = d['selftext_html'];
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
    ...(typeof body === 'string' && body !== '' && { selftext_html: body }),
  };
}

/** Crossposts of self posts carry a relative permalink as their URL. */
function absoluteUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    return new URL(raw, redditOrigin('www')).href;
  } catch {
    return null;
  }
}

/** Reddit asks clients to stop showing deleted and removed content. */
function isVisible(post: RedditPost): boolean {
  return !post.removed && post.author !== '[deleted]';
}

function flagsOf(post: RedditPost): DiscussionFlag[] {
  const flags: DiscussionFlag[] = [];
  if (post.over_18) flags.push('nsfw');
  if (post.spoiler) flags.push('spoiler');
  if (post.locked) flags.push('locked');
  if (post.archived) flags.push('archived');
  return flags;
}

export function toDiscussion(post: RedditPost, tier: Tier): Discussion {
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
    flags: flagsOf(post),
    ...(parent && { crosspostOf: parent }),
  };
}

/** Hides deleted and removed posts, dedupes by id, classifies, and drops posts in no tier. */
export function matchPosts(posts: readonly RedditPost[], page: UrlKeys): Discussion[] {
  return classifyHits(uniqueVisible(posts), [page]).map((p) => toDiscussion(p, p.tier));
}

/** The posts that may be shown, each once. */
function uniqueVisible(posts: readonly RedditPost[]): RedditPost[] {
  const seen = new Set<string>();
  return posts.filter((p) => {
    if (!isVisible(p) || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

/**
 * One admitted request, with the rate guard's bookkeeping: its outcome and, when it answered with a
 * listing, the posts in it.
 */
async function fetchPosts(
  url: string,
  ctx: Pick<RedditContext, 'depth' | 'signal' | 'env' | 'guard'>,
): Promise<{ outcome: HttpOutcome; posts: RedditPost[] | null }> {
  const outcome = await getJson(url, redditPolicy(ctx.depth), ctx.env, ctx.signal);
  await ctx.guard.observe(outcome);
  const posts = outcome.kind === 'ok' ? parseListings(outcome.data) : null;
  await ctx.guard.conclude({
    anyOk: posts !== null,
    signedOut: outcome.kind === 'login',
    challenged: outcome.kind === 'challenge',
  });
  return { outcome, posts };
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
  /**
   * A request failed and ended the plan (a sign-in wall, a challenge, a 429, an error), though an
   * earlier one answered: nothing more should be sent to Reddit in this lookup.
   */
  stopped?: true;
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
    signedOut: failures.some((f) => f.kind === 'login'),
    challenged: failures.some((f) => f.kind === 'challenge'),
  });

  if (anyOk || previous || attempts.length === 0) {
    // With nothing sent (no usable query or variant), the result is only what was seeded.
    const base = attempts.length > 0 || previous?.complete === true;
    return {
      state: { status: 'ok', items, complete: base && failures.length === 0 },
      ...(failures.length > 0 && { stopped: true }),
    };
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
  if (f.kind === 'login') return 0;
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
  /**
   * Nothing to look up: a self post, or (`linkPost`) a post linking to another Reddit thread, such
   * as a crosspost. The thread itself, if it may be shown.
   */
  | { kind: 'self'; thread?: Discussion; linkPost?: true }
  /** No such post. */
  | { kind: 'unknown' }
  /** The rate guard said no, or the request failed. */
  | { kind: 'failed'; state: SourceState };

/** Resolves a Reddit thread page to the URL it links to with one T request. */
export async function resolveRedditThread(id: string, ctx: RedditContext): Promise<RedditThread> {
  const { guard } = ctx;
  const admission = await guard.admit({ depth: ctx.depth, force: ctx.force, cost: 1 });
  if (!admission.ok) return { kind: 'failed', state: admission.state };
  const { outcome, posts } = await fetchPosts(postUrl(id), ctx);
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
  // A crosspost, or a post linking to another thread or comment, has nothing more to look up.
  if (post.is_self || splitIdentity(computeKeys(post.url)?.identity)[0] === 'reddit') {
    return { kind: 'self', ...(thread && { thread }), ...(!post.is_self && { linkPost: true }) };
  }
  return { kind: 'link', url: post.url, post, ...(thread && { thread }) };
}

/** One search request for a known URL: true when Reddit answers, false when it asks to sign in. */
export async function checkSignedIn(
  ctx: Omit<RedditContext, 'depth' | 'force'>,
): Promise<boolean | null> {
  const { outcome, posts } = await fetchPosts(searchUrl('xkcd.com/927', 1), {
    ...ctx,
    depth: 'auto',
  });
  if (posts) return true;
  return outcome.kind === 'login' ? false : null;
}

/**
 * The phrase that finds links to the page in post text and titles, and in Reddit's own comment
 * search: the content id on sites whose links come in several forms (youtu.be and /shorts/, x.com
 * and twitter.com, arXiv /abs and /pdf), otherwise the `url:` search term ("xkcd.com/927").
 */
export function mentionTerm(keys: UrlKeys): string {
  const [kind, id] = splitIdentity(keys.identity);
  switch (kind) {
    case 'youtube':
    case 'youtube-list':
    case 'twitter':
    case 'medium':
    case 'arxiv':
      return id;
    default:
      return searchQuery(keys);
  }
}

/** A URL never holds a raw `"`, so the term can't end the phrase early. */
const quoted = (term: string) => `"${term}"`;
const fitsSearch = (term: string) => quoted(term).length <= MAX_SEARCH_QUERY;

/** Posts per mention search: each carries its text twice (markdown and HTML), up to 40k each. */
const MENTION_LIMIT = 50;

/** M: newest posts with the phrase in their text or title. */
export function mentionSearchUrl(term: string): string {
  return `${OLD_REDDIT}/search.json?q=${encodeURIComponent(quoted(term))}&sort=new&t=all&type=link&limit=${MENTION_LIMIT}&raw_json=1`;
}

/**
 * Reddit's own comment search for the page, which Find On only links to: www, because old Reddit
 * has none. Null when the phrase is too long to search.
 */
export function commentSearchUrl(keys: UrlKeys): string | null {
  const term = mentionTerm(keys);
  return fitsSearch(term)
    ? `${redditOrigin('www')}/search/?q=${encodeURIComponent(quoted(term))}&type=comments`
    : null;
}

/**
 * Keeps the visible posts whose text or title links to the page. A post's own URL is never read: a
 * link post to the page is a discussion.
 */
export function matchMentionPosts(posts: readonly RedditPost[], page: UrlKeys): Mention[] {
  const unique = uniqueVisible(posts);
  // Each post's text links, then its title links, all in one batch: post i is items 2i and 2i+1.
  const linking = linkingItems(
    unique.flatMap((p) => [linksInHtml(p.selftext_html ?? ''), urlsInText(p.title)]),
    page,
  );
  return unique.flatMap((p, i): Mention[] => {
    const link = linking.has(2 * i) ? 'text' : linking.has(2 * i + 1) ? 'title' : undefined;
    if (link === undefined) return [];
    const createdAt = p.created_utc * 1000;
    return [
      {
        source: 'reddit',
        id: p.id,
        title: p.title,
        venue: p.subreddit,
        permalink: p.permalink,
        post: { link, author: p.author, points: p.score, comments: p.num_comments, createdAt },
        inComments: 0,
        linkedAt: createdAt,
        flags: flagsOf(p),
      },
    ];
  });
}

/**
 * Finds Reddit posts that link to the page in their text or title, with one search (M). Its
 * failures never touch the source's state: the discussion requests report account problems. With
 * `stopped` (a request in this lookup's discussion plan failed) nothing is sent, but the rate guard
 * still says when Reddit can be asked again.
 */
export async function lookupRedditMentions(
  page: UrlKeys,
  ctx: RedditContext,
  { stopped = false } = {},
): Promise<MentionState> {
  const term = mentionTerm(page);
  if (!fitsSearch(term)) return { status: 'ok', items: [], complete: true };
  const { guard } = ctx;
  // Optional: a challenged account, or one low on requests, is not asked even for the popup.
  const admission = await guard.admit({
    depth: ctx.depth,
    force: ctx.force,
    cost: 1,
    optional: true,
  });
  if (!admission.ok) {
    const { state } = admission;
    return state.status === 'deferred'
      ? { status: 'failed' }
      : { status: 'failed', retryAt: state.retryAt };
  }
  if (stopped) return { status: 'failed' };
  const { outcome, posts } = await fetchPosts(mentionSearchUrl(term), ctx);
  if (outcome.kind === 'rate-limited') return { status: 'failed', retryAt: outcome.retryAt };
  if (!posts) return { status: 'failed' };
  return {
    status: 'ok',
    items: matchMentionPosts(posts, page),
    complete: posts.length < MENTION_LIMIT,
  };
}
