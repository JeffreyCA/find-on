// Hacker News through the HN Algolia search API. Pure TS.
//
// Algolia is a candidate generator only: it searches the submitted URL text, and every hit is then
// classified locally against the page's keys (SAME / EXACT / SIMILAR). Hits in no tier are dropped.
// Mentions work the same way: Algolia searches comment and post text, and only the comments and
// posts with a link to the page are kept.

import { failureState, getJson, REQUEST_TIMEOUT_MS, type FetchPolicy, type HttpEnv } from '../http';
import {
  isRecord,
  type Depth,
  type Discussion,
  type Mention,
  type MentionState,
  type SourceState,
} from '../types';
import { classifyHits, splitIdentity, type UrlKeys } from '../url';
import { registrableLabels } from '../url/common';
import { hasStrongMatch, numberOr0, stringOr, type OkState } from './common';
import { linkingItems, linksInHtml } from './text-links';

export const HN_SEARCH_API = 'https://hn.algolia.com/api/v1/search';
export const HN_SEARCH_BY_DATE_API = 'https://hn.algolia.com/api/v1/search_by_date';

/** Fixed search parameters, each chosen by measuring results for URLs with known HN submissions. */
const SEARCH_PARAMS = {
  restrictSearchableAttributes: 'url',
  tags: 'story',
  typoTolerance: 'false',
  advancedSyntax: 'false',
  analytics: 'false',
  attributesToRetrieve: 'title,url,points,num_comments,author,created_at_i',
  attributesToHighlight: 'none',
} as const;

const FIRST_PAGE = 100;
/** Algolia's hard cap. Discussion searches use it only on user-initiated lookups. */
const WIDE_PAGE = 1000;
/** Algolia rejects queries of 512 bytes or more. Query words are ASCII, so length is bytes. */
const MAX_QUERY_LENGTH = 480;

/** One Algolia hit with the attributes we ask for. Text posts have no `url`. */
export interface AlgoliaHit {
  objectID: string;
  title: string;
  url?: string;
  points: number;
  num_comments: number;
  author: string;
  created_at_i: number;
}

export interface HnContext {
  depth: Depth;
  signal: AbortSignal;
  env: HttpEnv;
}

/** Network errors, timeouts, 429 and 5xx are retried with backoff: twice for `full`, once for `auto`. */
export function hnPolicy(depth: Depth): FetchPolicy {
  return {
    credentials: 'omit',
    timeoutMs: REQUEST_TIMEOUT_MS,
    retries: depth === 'full' ? 2 : 1,
    retryRateLimited: true,
  };
}

export function searchUrl(query: string, hitsPerPage: number): string {
  const params = new URLSearchParams({
    query,
    ...SEARCH_PARAMS,
    hitsPerPage: String(hitsPerPage),
  });
  return `${HN_SEARCH_API}?${params}`;
}

/** Lookup of one story by id: its URL (absent for text posts) and display fields. */
export function itemUrl(id: string): string {
  const params = new URLSearchParams({
    tags: `story,story_${id}`,
    hitsPerPage: '1',
    attributesToRetrieve: SEARCH_PARAMS.attributesToRetrieve,
    attributesToHighlight: 'none',
    analytics: 'false',
  });
  return `${HN_SEARCH_API}?${params}`;
}

/**
 * Algolia query text for a URL. Separator-joined chunks stay whole ("example.com",
 * "the-busy-trap"), which Algolia matches like a phrase and is far more precise than loose words.
 * The registrable domain is one chunk and the other host labels are loose words, so
 * "en.wikipedia.org" also finds "en.m.wikipedia.org" submissions. Path segments containing %XX keep
 * only their clean ASCII pieces ("Kurt_G%C3%B6del" -> "kurt"), because HN stores both "G%C3%B6del"
 * and "Gödel" spellings. A segment with no such piece ("Fl%C3%A2neur") is kept whole, as encoded:
 * Algolia splits it the same way as the stored encoded URL, the common spelling. No scheme, query
 * string or fragment: they only cost recall.
 *
 * For mentions, such a segment is split at every other character too: a query that keeps only "go"
 * or "law" matches tens of thousands of comments. A word right after an ASCII escape or an
 * apostrophe is left out, because Algolia indexes the escaped spelling with the digits attached
 * ("%27Reilly" as "27reilly"): "Goodhart%27s_law" and "Goodhart's_law" both give "goodhart law".
 * A segment with no word longer than a letter ("C%2B%2B") is kept whole.
 */
export function buildQuery(host: string, rawPath: string, { mention = false } = {}): string {
  const labels = host.split('.');
  const n = registrableLabels(host);
  const hostWords = [labels.slice(-n).join('.'), ...labels.slice(0, -n)].filter(Boolean);
  const pathWords: string[] = [];
  for (const seg of rawPath
    .replace(/\/(?:index|default)\.(?:html?|php|aspx?|jsp)$/i, '/')
    .split('/')) {
    if (!seg) continue;
    if (/^[A-Za-z0-9._~+-]+$/.test(seg)) {
      const trimmed = seg.replace(/^[._~+-]+|[._~+-]+$/g, '');
      if (trimmed) pathWords.push(trimmed);
    } else if (mention) {
      const pieces = seg
        .replace(/(?:%[0-7][0-9A-Fa-f]|')[A-Za-z0-9]*/g, ' ')
        .split(/[^A-Za-z0-9%]+/)
        .filter((piece) => /^[A-Za-z0-9]+$/.test(piece));
      if (pieces.some((piece) => piece.length > 1)) pathWords.push(...pieces);
      else if (/%[0-9A-Fa-f]{2}/.test(seg)) pathWords.push(seg);
      else pathWords.push(...pieces);
    } else {
      const pieces = seg.split(/[-_.~+]+/).filter((piece) => /^[A-Za-z0-9]+$/.test(piece));
      if (pieces.length > 0) pathWords.push(...pieces);
      else if (/%[0-9A-Fa-f]{2}/.test(seg)) pathWords.push(seg);
    }
  }
  // Each word must match a distinct occurrence in the URL, so duplicates would exclude matches.
  const words = [...new Set([...hostWords, ...pathWords].map((w) => w.toLowerCase()))];
  const fixed = new Set(hostWords.map((w) => w.toLowerCase())).size;
  // Algolia prefix-matches the last word, so a one-letter last word ("x") matches almost anything.
  const last = words.at(-1);
  if (mention && last?.length === 1 && words.length > fixed + 1) {
    words.pop();
    words.splice(-1, 0, last);
  }
  // Too long: drop middle path words first, keeping the host and the last path word.
  while (joinedLength(words) > MAX_QUERY_LENGTH && words.length > fixed + 1) words.splice(fixed, 1);
  // Still too long (one huge segment): cut the last word. Algolia prefix-matches the last word.
  if (joinedLength(words) > MAX_QUERY_LENGTH) {
    const head = words.slice(0, -1).join(' ');
    return `${head} ${words.at(-1) ?? ''}`.trim().slice(0, MAX_QUERY_LENGTH).trim();
  }
  return words.join(' ');
}

const joinedLength = (words: readonly string[]) => words.join(' ').length;

export interface HnQuery {
  query: string;
  /** Identifier-like query-string values: sent on escalation, and always in mention searches. */
  idValues: string[];
}

/**
 * The search query for a page. Identity sites query by their content id (placed last, so Algolia's
 * prefix match on the last word also covers "1706.03762v2"), which matches every spelling of the
 * URL and never requires a slug that other submissions may lack. Other pages use buildQuery, in
 * its mention form for `mention`.
 */
export function hnQuery(keys: UrlKeys, { mention = false } = {}): HnQuery {
  const [kind, id] = splitIdentity(keys.identity);
  switch (kind) {
    case 'youtube':
    case 'youtube-list':
    case 'twitter':
    case 'medium':
      return { query: id, idValues: [] };
    case 'arxiv':
      return { query: `arxiv.org ${id}`, idValues: [] };
    case 'reddit':
      return { query: buildQuery('reddit.com', `/comments/${id}`), idValues: [] };
    case 'hn':
      return { query: `${buildQuery('news.ycombinator.com', '/item')} ${id}`, idValues: [] };
    case 'github':
      // The repository, also from its default-branch tree pages.
      return { query: buildQuery('github.com', `/${id}`), idValues: [] };
    default:
      break;
  }
  const url = new URL(keys.cleaned);
  const host = queryHost(url.hostname);
  // Stack Exchange questions ("stackoverflow.com:q123"): the slug after the id is optional.
  const question = /^q(\d+)$/.exec(id)?.[1];
  if (question) return { query: buildQuery(host, `/questions/${question}`), idValues: [] };
  return { query: buildQuery(host, url.pathname, { mention }), idValues: idValues(keys) };
}

/** Host for the query: no "www"/"m."/"mobile."/"amp." prefixes (they only exclude matches). */
function queryHost(hostname: string): string {
  let host = hostname.toLowerCase().replace(/\.$/, '');
  while (/^(?:www\d*|m|mobile|amp)\./.test(host) && host.split('.').length > 2) {
    host = host.replace(/^[^.]+\./, '');
  }
  return host.replace(/^([a-z-]+)\.m\.(wiki[a-z]+\.org|wiktionary\.org|wikimedia\.org)$/, '$1.$2');
}

/**
 * Values of the parameters the SIMILAR key keeps (identity parameters such as `?id=`, never
 * tracking, referral or secret-looking ones), split into words.
 */
function idValues(keys: UrlKeys): string[] {
  const query = keys.similar.split('#', 1)[0]?.split('?')[1];
  if (!query) return [];
  const words: string[] = [];
  for (const [, value] of new URLSearchParams(query)) {
    if (/^[A-Za-z0-9._-]{1,64}$/.test(value)) words.push(...value.split(/[._-]+/).filter(Boolean));
  }
  return [...new Set(words.map((w) => w.toLowerCase()))];
}

function withIdValues(query: string, values: readonly string[]): string {
  let out = query;
  for (const value of values) {
    if (out.length + 1 + value.length > MAX_QUERY_LENGTH) break;
    out = `${out} ${value}`;
  }
  return out;
}

type SearchResult =
  | { ok: true; hits: AlgoliaHit[]; nbHits: number }
  | { ok: false; state: SourceState };

async function search(url: string, ctx: HnContext): Promise<SearchResult> {
  const outcome = await getJson(url, hnPolicy(ctx.depth), ctx.env, ctx.signal);
  if (outcome.kind !== 'ok') return { ok: false, state: failureState(outcome, 'hn') };
  const parsed = parseSearch(outcome.data);
  if (!parsed) {
    return {
      ok: false,
      state: { status: 'error', kind: 'format', detail: 'unexpected search response' },
    };
  }
  return { ok: true, ...parsed };
}

/** Validates an Algolia search response; malformed hits are skipped, a malformed body is null. */
export function parseSearch(data: unknown): { hits: AlgoliaHit[]; nbHits: number } | null {
  if (!isRecord(data) || !Array.isArray(data['hits'])) return null;
  const hits = data['hits'].flatMap((h: unknown) => {
    const hit = parseHit(h);
    return hit ? [hit] : [];
  });
  const nbHits = typeof data['nbHits'] === 'number' ? data['nbHits'] : hits.length;
  return { hits, nbHits };
}

function parseHit(h: unknown): AlgoliaHit | null {
  if (!isRecord(h) || typeof h['objectID'] !== 'string' || !/^\d+$/.test(h['objectID']))
    return null;
  const url = typeof h['url'] === 'string' && h['url'] !== '' ? h['url'] : undefined;
  return {
    objectID: h['objectID'],
    title: stringOr(h['title'], ''),
    ...(url !== undefined && { url }),
    points: numberOr0(h['points']),
    num_comments: numberOr0(h['num_comments']),
    author: stringOr(h['author'], ''),
    created_at_i: numberOr0(h['created_at_i']),
  };
}

export function toDiscussion(hit: AlgoliaHit, tier: Discussion['tier']): Discussion {
  return {
    source: 'hn',
    id: hit.objectID,
    title: hit.title,
    submittedUrl: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
    venue: '',
    author: hit.author,
    points: hit.points,
    comments: hit.num_comments,
    createdAt: hit.created_at_i * 1000,
    tier,
    permalink: `/item?id=${hit.objectID}`,
    flags: [],
  };
}

/** Classifies hits against the page, drops the ones in no tier, dedupes by id. */
function matchHits(hits: readonly AlgoliaHit[], page: UrlKeys): Discussion[] {
  const seen = new Set<string>();
  const unique = hits.filter((h): h is AlgoliaHit & { url: string } => {
    if (h.url === undefined || seen.has(h.objectID)) return false;
    seen.add(h.objectID);
    return true;
  });
  return classifyHits(unique, [page]).map((h) => toDiscussion(h, h.tier));
}

export interface HnLookupOptions extends HnContext {
  /** Result of an earlier `auto` lookup of the same page; a `full` lookup only widens it. */
  previous?: OkState;
  /** Hits already known (the thread the user is on), matched along with the search results. */
  seed?: readonly AlgoliaHit[];
}

/**
 * Searches HN for discussions of the page. The first request asks for 100 hits. Only
 * when Algolia has more candidates and none matched SAME/EXACT is a second request sent: with the
 * page's identifier values appended if it has any, else (only for `full`) with 1000 hits.
 */
export async function lookupHn(page: UrlKeys, opts: HnLookupOptions): Promise<SourceState> {
  const { query, idValues: ids } = hnQuery(page);
  const seed = opts.seed ?? [];
  const { previous } = opts;

  if (previous) {
    const widen =
      opts.depth === 'full' &&
      !previous.complete &&
      !hasStrongMatch(previous.items) &&
      ids.length === 0;
    if (!widen) return previous;
    const wide = await search(searchUrl(query, WIDE_PAGE), opts);
    if (!wide.ok) return previous;
    return {
      status: 'ok',
      items: matchHits([...seed, ...wide.hits], page),
      complete: wide.nbHits <= wide.hits.length,
    };
  }

  const first = await search(searchUrl(query, FIRST_PAGE), opts);
  if (!first.ok) return first.state;
  let hits = [...seed, ...first.hits];
  let complete = first.nbHits <= first.hits.length;
  let items = matchHits(hits, page);

  if (!complete && !hasStrongMatch(items)) {
    let second: SearchResult | undefined;
    if (ids.length > 0)
      second = await search(searchUrl(withIdValues(query, ids), FIRST_PAGE), opts);
    else if (opts.depth === 'full') second = await search(searchUrl(query, WIDE_PAGE), opts);
    if (second?.ok) {
      // The identifier query narrows the first one; the wide query replaces it.
      hits = ids.length > 0 ? [...hits, ...second.hits] : [...seed, ...second.hits];
      complete = second.nbHits <= second.hits.length;
      items = matchHits(hits, page);
    }
  }
  return { status: 'ok', items, complete };
}

export type HnItem =
  /** A link story: look up its URL. `hit` is the story itself. */
  | { kind: 'link'; url: string; hit: AlgoliaHit }
  /** A text post (Ask HN and the like): nothing to look up but the thread itself. */
  | { kind: 'text'; thread: Discussion }
  /** Not a story Algolia knows (a comment, job, dead or brand-new item). */
  | { kind: 'unknown' }
  /** The request failed. */
  | { kind: 'failed'; state: SourceState };

/** Resolves `news.ycombinator.com/item?id=<id>` to the story's URL. */
export async function resolveHnItem(id: string, opts: HnContext): Promise<HnItem> {
  const result = await search(itemUrl(id), opts);
  if (!result.ok) return { kind: 'failed', state: result.state };
  const hit = result.hits.find((h) => h.objectID === id);
  if (!hit) return { kind: 'unknown' };
  if (hit.url !== undefined) return { kind: 'link', url: hit.url, hit };
  return { kind: 'text', thread: toDiscussion(hit, 'same') };
}

/** Comments and text posts whose text holds the query words, newest first. */
const MENTION_PARAMS = {
  tags: '(story,comment)',
  restrictSearchableAttributes: 'comment_text,story_text',
  typoTolerance: 'false',
  // On by default, it reads a leading "-" (as in some YouTube ids) as "without this word".
  advancedSyntax: 'false',
  analytics: 'false',
  attributesToRetrieve:
    '_tags,title,story_id,story_title,comment_text,story_text,created_at_i,author,points,num_comments',
  attributesToHighlight: 'none',
} as const;

/** A first page with fewer threads than this is widened, when the wide page holds every hit. */
const MENTIONS_ENOUGH = 10;
/** Threads kept, newest first; bounds the cached result. */
export const MAX_MENTIONS = 100;

export function mentionSearchUrl(query: string, hitsPerPage: number): string {
  const params = new URLSearchParams({
    query,
    ...MENTION_PARAMS,
    hitsPerPage: String(hitsPerPage),
  });
  return `${HN_SEARCH_BY_DATE_API}?${params}`;
}

/** The page's query for mentions, with its identifier values: a link in a comment has them all. */
function mentionQuery(keys: UrlKeys): string {
  const { query, idValues: ids } = hnQuery(keys, { mention: true });
  return withIdValues(query, ids);
}

/** A comment, or a story with text, from the mention search. */
interface MentionHit {
  objectID: string;
  kind: 'comment' | 'story';
  /** The story: its own objectID, or a comment's story_id. */
  thread: string;
  title: string;
  /** `comment_text` or `story_text`. */
  html: string;
  /** Epoch seconds. */
  created_at_i: number;
  author: string;
  /** A story's own numbers (comments have none). */
  points: number;
  num_comments: number;
}

interface MentionPage {
  hits: MentionHit[];
  nbHits: number;
  /** Hits in the response, including the malformed ones that were skipped. */
  fetched: number;
}

/** Validates a mention search response; malformed hits are skipped, a malformed body is null. */
export function parseMentionSearch(data: unknown): MentionPage | null {
  if (!isRecord(data) || !Array.isArray(data['hits'])) return null;
  const raw: unknown[] = data['hits'];
  const hits = raw.flatMap((h) => {
    const hit = parseMentionHit(h);
    return hit ? [hit] : [];
  });
  const nbHits = typeof data['nbHits'] === 'number' ? data['nbHits'] : raw.length;
  return { hits, nbHits, fetched: raw.length };
}

function parseMentionHit(h: unknown): MentionHit | null {
  if (!isRecord(h) || typeof h['objectID'] !== 'string' || !/^\d+$/.test(h['objectID'])) {
    return null;
  }
  const tags = Array.isArray(h['_tags']) ? h['_tags'] : [];
  const kind = tags.includes('comment') ? 'comment' : tags.includes('story') ? 'story' : null;
  if (kind === null) return null;
  const storyId = h['story_id'];
  let thread = h['objectID'];
  if (kind === 'comment') {
    if (typeof storyId !== 'number' || !Number.isSafeInteger(storyId) || storyId <= 0) return null;
    thread = String(storyId);
  }
  // Comments of deleted stories have no story title.
  const title = stringOr(kind === 'comment' ? h['story_title'] : h['title'], '');
  const html = stringOr(kind === 'comment' ? h['comment_text'] : h['story_text'], '');
  if (title === '' || html === '') return null;
  return {
    objectID: h['objectID'],
    kind,
    thread,
    title,
    html,
    created_at_i: numberOr0(h['created_at_i']),
    author: stringOr(h['author'], ''),
    points: numberOr0(h['points']),
    num_comments: numberOr0(h['num_comments']),
  };
}

/**
 * Keeps the comments and text posts that link to the page and groups them by thread, newest
 * mention first. A story's own URL is never read: a story submitted with it is a discussion.
 */
function matchHnMentions(hits: readonly MentionHit[], page: UrlKeys): Mention[] {
  const seen = new Set<string>();
  const unique = hits.filter((h) => {
    if (seen.has(h.objectID)) return false;
    seen.add(h.objectID);
    return true;
  });
  const linking = linkingItems(
    unique.map((h) => linksInHtml(h.html)),
    page,
  );
  const threads = new Map<string, Mention>();
  unique.forEach((hit, index) => {
    const found = linking.get(index);
    if (found === undefined) return;
    const at = hit.created_at_i * 1000;
    const mention: Mention = threads.get(hit.thread) ?? {
      source: 'hn',
      id: hit.thread,
      title: hit.title,
      venue: '',
      permalink: `/item?id=${hit.thread}`,
      inComments: 0,
      linkedAt: at,
      flags: [],
    };
    threads.set(hit.thread, mention);
    if (hit.kind === 'story') {
      mention.title = hit.title;
      mention.post = {
        link: 'text',
        ...found,
        author: hit.author,
        points: hit.points,
        comments: hit.num_comments,
        createdAt: at,
      };
    } else {
      mention.inComments += 1;
      // `linkedAt` is still the newest earlier mention; a thread with a post drops commentId below.
      if (mention.commentId === undefined || at > mention.linkedAt)
        mention.commentId = hit.objectID;
    }
    mention.linkedAt = Math.max(mention.linkedAt, at);
  });
  const mentions = [...threads.values()];
  // A thread whose post links to the page opens at the post.
  for (const m of mentions) if (m.post) delete m.commentId;
  return mentions.toSorted(newestFirst);
}

function newestFirst(a: Mention, b: Mention): number {
  return b.linkedAt - a.linkedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

async function fetchMentions(url: string, ctx: HnContext): Promise<MentionPage | null> {
  const outcome = await getJson(url, hnPolicy(ctx.depth), ctx.env, ctx.signal);
  return outcome.kind === 'ok' ? parseMentionSearch(outcome.data) : null;
}

/**
 * Finds HN threads that link to the page from a comment or from the post's text. One search for
 * the newest 100 comments and text posts; when they hold few threads and 1000 hits would hold
 * every one, one more search for all of them.
 */
export async function lookupHnMentions(page: UrlKeys, ctx: HnContext): Promise<MentionState> {
  const query = mentionQuery(page);
  let found = await fetchMentions(mentionSearchUrl(query, FIRST_PAGE), ctx);
  if (!found) return { status: 'failed' };
  let items = matchHnMentions(found.hits, page);
  if (found.nbHits > found.fetched && found.nbHits <= WIDE_PAGE && items.length < MENTIONS_ENOUGH) {
    const wide = await fetchMentions(mentionSearchUrl(query, WIDE_PAGE), ctx);
    // A failed second search keeps what the first one found, and a short one adds to it.
    if (wide) {
      items = matchHnMentions([...found.hits, ...wide.hits], page);
      found = wide;
    }
  }
  return { status: 'ok', items: items.slice(0, MAX_MENTIONS) };
}
