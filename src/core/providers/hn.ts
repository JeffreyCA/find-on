// Hacker News through the HN Algolia search API. Pure TS.
//
// Algolia is a candidate generator only: it searches the submitted URL text, and every hit is then
// classified locally against the page's keys (SAME / EXACT / SIMILAR). Hits in no tier are dropped.

import { failureState, getJson, REQUEST_TIMEOUT_MS, type FetchPolicy, type HttpEnv } from '../http';
import { isRecord, type Depth, type Discussion, type SourceState } from '../types';
import { classifyHits, splitIdentity, type UrlKeys } from '../url';
import { registrableLabels } from '../url/common';
import { hasStrongMatch, numberOr0, stringOr, type OkState } from './common';

export const HN_SEARCH_API = 'https://hn.algolia.com/api/v1/search';

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
/** Algolia's hard cap; only for user-initiated lookups. */
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
 */
export function buildQuery(host: string, rawPath: string): string {
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
    } else {
      const pieces = seg.split(/[-_.~+]+/).filter((piece) => /^[A-Za-z0-9]+$/.test(piece));
      if (pieces.length > 0) pathWords.push(...pieces);
      else if (/%[0-9A-Fa-f]{2}/.test(seg)) pathWords.push(seg);
    }
  }
  // Each word must match a distinct occurrence in the URL, so duplicates would exclude matches.
  const words = [...new Set([...hostWords, ...pathWords].map((w) => w.toLowerCase()))];
  const fixed = new Set(hostWords.map((w) => w.toLowerCase())).size;
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
  /** Identifier-like query-string values, sent only on escalation. */
  idValues: string[];
}

/**
 * The search query for a page. Identity sites query by their content id (placed last, so Algolia's
 * prefix match on the last word also covers "1706.03762v2"), which matches every spelling of the
 * URL and never requires a slug that other submissions may lack. Other pages use buildQuery.
 */
export function hnQuery(keys: UrlKeys): HnQuery {
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
  return { query: buildQuery(host, url.pathname), idValues: idValues(keys) };
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
