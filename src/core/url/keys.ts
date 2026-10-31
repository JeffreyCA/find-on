// Match keys for a URL and tier classification (SAME / EXACT / SIMILAR). Pure, no browser APIs.

import type { Tier } from '../types';
import {
  decodeForDisplay,
  hostOf,
  parseHttp,
  pctNormalize,
  splitQuery,
  stripWww,
  type QueryParam,
} from './common';
import { ruleFor, type Parts, type SiteRule } from './site-rules';
import { isSecretParam, trackingFilter } from './tracking';
import { unwrap } from './unwrap';

export interface UrlKeys {
  /**
   * The http(s) URL after unwrapping (AMP, archives, redirect shims) with tracking, secret-looking
   * parameters, userinfo and plain fragments removed. Original scheme, host, path and parameter
   * order are kept. This is the form to send to other services.
   */
  cleaned: string;
  /** EXACT key: safe normalization, e.g. "example.com/post?id=5". */
  exact: string;
  /** SIMILAR key: aggressive normalization (most parameters dropped, m./amp. and index files folded). */
  similar: string;
  /** Site identity when a site rule knows one, e.g. "youtube:dQw4w9WgXcQ", "hn:36550615". */
  identity?: string;
}

/** An identity's kind and id ("youtube:dQw4w9WgXcQ" -> ["youtube", "dQw4w9WgXcQ"]); "" for none. */
export function splitIdentity(identity: string | undefined): [kind: string, id: string] {
  const colon = identity?.indexOf(':') ?? -1;
  return identity === undefined || colon < 0
    ? ['', '']
    : [identity.slice(0, colon), identity.slice(colon + 1)];
}

/** "Where did you come from" parameters: kept by EXACT, dropped by SIMILAR. */
const AMBIGUOUS_SOURCE = new Set([
  'ref',
  'ref_src',
  'ref_url',
  'referrer',
  'referer',
  'source',
  'src',
  'from',
  'via',
  'share',
  'shared',
  'share_id',
  'feature',
  'campaign',
  'cmp',
  'trk',
  'sr_share',
  '_fb_noscript',
  'hn',
  'fj',
  'sk',
  'st',
  'mod',
  'reflink',
  'lang',
  'hl',
  'locale',
  'page',
  'amp',
  'outputtype',
  'output',
  'usp',
  'r',
  'si',
  'context',
  'tab',
  'view',
  'ved',
  'ei',
]);

/** Parameters that usually identify content; SIMILAR keeps them on paths that are not weak. */
const GENERIC_IDENTITY = new Set([
  'id',
  'p',
  'page_id',
  'pid',
  'v',
  'article',
  'articleid',
  'article_id',
  'story',
  'storyid',
  'story_id',
  'post',
  'postid',
  'post_id',
  'topic',
  'thread',
  'threadid',
  'item',
  'itemid',
  'issue',
  'doc',
  'docid',
  'abstract_id',
  'paper',
  'q',
  'query',
  'name',
  'title',
  'user_id',
  'doi',
  'isbn',
  'pmid',
  'pmcid',
  'arxiv',
  'objectid',
  'record',
  'recordid',
  'video',
  'vid',
  'showtopic',
]);

const SCRIPT_EXT = /\.(?:php\d?|aspx?|jspx?|cgi|pl|py|cfm|do|action|nsf|exe|dll)$/i;
/** A single plain word ("download", "item", "viewtopic") does not identify a page by itself. */
const GENERIC_LAST_SEGMENT = /^[A-Za-z_]{1,16}$/;
const INDEX_FILE = /\/(?:index|default)\.(?:html?|php\d?|aspx?|jsp|shtml|cfm)$/i;
const SESSION_PATH_PARAM = /;(?:jsessionid|phpsessid|sid|sessionid)=[^/]*/gi;

/**
 * When SIMILAR-only matches span more than this many distinct pages, the dropped parameters
 * evidently identify different pages on that site (citeseerx `viewdoc/download?doi=`), so all
 * SIMILAR matches are discarded.
 */
const SIMILAR_FANOUT_LIMIT = 3;

function normalizePath(pathname: string, literal: boolean): string {
  const path = pctNormalize(pathname)
    .replace(SESSION_PATH_PARAM, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '');
  return literal ? path : path.replace(/\/index\.html?$/i, '');
}

/**
 * Keeps "#!" and "#/" routes of hash-routed apps, without secret-looking parameters. An empty route
 * ("#/", "#!") is the page itself.
 */
export function hashRoute(hash: string): string {
  if (!/^#[!/]/.test(hash) || /^#!?\/?$/.test(hash)) return '';
  const q = hash.indexOf('?');
  if (q < 0) return pctNormalize(hash);
  const kept = splitQuery(hash.slice(q)).filter((p) => !isSecretParam(p.name, p.value));
  const query = kept.map((p) => p.raw).join('&');
  return pctNormalize(hash.slice(0, q) + (query ? `?${query}` : ''));
}

const encodeComponent = (s: string) => encodeURIComponent(s.normalize('NFC'));

function serialize(p: Parts): string {
  // Stable sort by name only: repeated keys keep their relative order.
  const params = p.params.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params
    .map(([k, v]) =>
      v === '' ? encodeComponent(k) : `${encodeComponent(k)}=${encodeComponent(v)}`,
    )
    .join('&');
  return `${p.host}${p.port ? `:${p.port}` : ''}${p.path}${query ? `?${query}` : ''}${p.route}`;
}

function isWeakPath(path: string): boolean {
  const last = path.slice(path.lastIndexOf('/') + 1);
  return (
    path === '' ||
    SCRIPT_EXT.test(path) ||
    /\/cgi(?:-bin)?(?:\/|$)/.test(path) ||
    GENERIC_LAST_SEGMENT.test(last)
  );
}

/** Host and path folds of the SIMILAR tier (parameters are filtered separately). */
function foldForSimilar(p: Parts, rule: SiteRule | undefined): Parts {
  const host = /^(?:m|mobile|amp)\./.test(p.host) && p.host.split('.').length > 2;
  let s: Parts = host ? { ...p, host: p.host.replace(/^[^.]+\./, '') } : p;
  if (rule?.similar) s = rule.similar(s);
  if (!rule?.literalPaths) {
    const path = s.path
      .replace(INDEX_FILE, '')
      .replace(/\/amp$/, '')
      .replace(/\.amp(\.html?)$/i, '$1');
    s = { ...s, path };
  }
  return s;
}

function keepForSimilar(name: string, value: string, weak: boolean, rule?: SiteRule): boolean {
  const n = name.toLowerCase();
  if (isSecretParam(n, value)) return false;
  if (rule?.similarParams) return rule.similarParams.includes(n);
  if (AMBIGUOUS_SOURCE.has(n)) return false;
  return weak || GENERIC_IDENTITY.has(n);
}

function cleanedHref(url: URL, kept: QueryParam[], route: string): string {
  const u = new URL(url.href);
  u.username = '';
  u.password = '';
  u.hostname = u.hostname.replace(/\.$/, '');
  u.pathname = u.pathname.replace(SESSION_PATH_PARAM, '');
  const query = kept.filter((p) => !isSecretParam(p.name, p.value)).map((p) => p.raw);
  u.search = query.length > 0 ? `?${query.join('&')}` : '';
  u.hash = route;
  return u.href;
}

interface Analysis {
  keys: UrlKeys;
  /**
   * The page after SIMILAR folds with every non-ambiguous parameter kept. Variants that differ
   * only in referral noise (?ref=, /amp, m.) share it; the fan-out guard counts distinct values.
   */
  variant: string;
}

function analyze(input: string): Analysis | null {
  const parsed = parseHttp(input);
  if (!parsed) return null;
  const url = unwrap(parsed);
  const rawHost = hostOf(url);
  const host = stripWww(rawHost);
  const rule = ruleFor(host);
  const isTracking = trackingFilter(rawHost, url.pathname + url.search, rule?.tracking);
  const kept = splitQuery(url.search).filter((p) => p.name !== '' && !isTracking(p.name, p.value));
  const route = hashRoute(url.hash);
  const base: Parts = {
    host,
    port: url.port,
    path: normalizePath(url.pathname, rule?.literalPaths ?? false),
    params: kept.map((p) => [p.name, p.value] as const),
    route,
  };

  // EXACT: safe normalization plus unambiguous site rewrites.
  const exactParts = rule?.rewrite?.(base) ?? base;
  const identity = rule?.identity?.(exactParts);

  // SIMILAR: aggressive folds; on weak paths every non-ambiguous parameter still counts.
  const folded = foldForSimilar(exactParts, rule);
  const weak = isWeakPath(folded.path);
  const similarParams = folded.params.filter(([k, v]) => keepForSimilar(k, v, weak, rule));
  const variantParams = folded.params.filter(
    ([k, v]) => !AMBIGUOUS_SOURCE.has(k.toLowerCase()) && !isSecretParam(k, v),
  );

  const keys: UrlKeys = {
    cleaned: cleanedHref(url, kept, route),
    exact: serialize(exactParts),
    similar: serialize({ ...folded, params: similarParams }),
  };
  if (identity) keys.identity = identity;
  return { keys, variant: serialize({ ...folded, params: variantParams }) };
}

/** Match keys for an http(s) URL, or null for anything else. */
export function computeKeys(url: string): UrlKeys | null {
  return analyze(url)?.keys ?? null;
}

function tierOf(candidate: UrlKeys, page: readonly UrlKeys[]): Tier | null {
  const { identity } = candidate;
  if (identity !== undefined && page.some((k) => k.identity === identity)) return 'same';
  if (page.some((k) => k.exact === candidate.exact)) return 'exact';
  if (page.some((k) => k.similar === candidate.similar)) return 'similar';
  return null;
}

/** Tier of a submitted URL against the page's keys, or null when it is another page. */
export function classify(candidateUrl: string, page: readonly UrlKeys[]): Tier | null {
  const keys = computeKeys(candidateUrl);
  return keys ? tierOf(keys, page) : null;
}

/**
 * Classifies a batch of submissions, drops the ones that match no tier and applies the SIMILAR
 * fan-out guard (see SIMILAR_FANOUT_LIMIT). Order is preserved.
 */
export function classifyHits<T extends { url: string }>(
  hits: readonly T[],
  page: readonly UrlKeys[],
): Array<T & { tier: Tier }> {
  const cache = new Map<string, Analysis | null>();
  const matched: Array<{ hit: T; tier: Tier; variant: string }> = [];
  for (const hit of hits) {
    let analysis = cache.get(hit.url);
    if (analysis === undefined) {
      analysis = analyze(hit.url);
      cache.set(hit.url, analysis);
    }
    const tier = analysis && tierOf(analysis.keys, page);
    if (analysis && tier) matched.push({ hit, tier, variant: analysis.variant });
  }
  const similarVariants = new Set(
    matched.filter((m) => m.tier === 'similar').map((m) => m.variant),
  );
  const dropSimilar = similarVariants.size > SIMILAR_FANOUT_LIMIT;
  return (
    matched
      .filter((m) => !(dropSimilar && m.tier === 'similar'))
      // oxlint-disable-next-line oxc/no-map-spread -- hits belong to the caller; never mutate them
      .map((m) => ({ ...m.hit, tier: m.tier }))
  );
}

/** Short human form of the looked-up page, e.g. "xkcd.com/927" or "en.wikipedia.org/wiki/Café". */
export function displayUrl(keys: UrlKeys): string {
  return decodeForDisplay(keys.exact);
}
