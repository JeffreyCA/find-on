// Links in comment and post bodies, for mentions: hrefs and URLs written as plain text, and which
// bodies link to the page. Pure TS; no DOMParser, which the service worker lacks.

import type { Tier } from '../types';
import { classifyHits, type UrlKeys } from '../url';

const HREF = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const ANCHOR = /<a\b[^>]*>[\s\S]*?<\/a\s*>/gi;
const TAG = /<[^>]*>/g;
const ENTITY = /&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"`]+/gi;
/** "xkcd.com/927": a dotted host with a letter TLD, then a path. A bare host never counts. */
const SCHEMELESS = /(?<![\w@./:-])(?:[a-z0-9-]+\.)+[a-z]{2,63}\/[^\s<>"`]+/gi;
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
/** Punctuation that ends a sentence rather than a URL. */
const TRAILING = ".,;:!?'*";

/**
 * Every link in an HTML body (HN `comment_text`, Reddit `selftext_html`): each href, then the URLs
 * written as text outside links. Link text is never read, because HN shortens long link text
 * ("https://example.com/lo..."). An href keeps its trailing punctuation ("Sagittarius_A*"): the
 * site's linkifier already left a sentence's out.
 */
export function linksInHtml(html: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(HREF)) {
    const href = match[1] ?? match[2];
    if (href) links.push(trimUrl(decodeEntities(href).trim(), false));
  }
  // Tags go before entities are decoded, so a decoded "&lt;a" can't be mistaken for one.
  const text = decodeEntities(html.replace(ANCHOR, ' ').replace(TAG, ' '));
  return [...new Set([...links, ...urlsInText(text)])];
}

/**
 * URLs written in plain text: with a scheme, or as a host and path ("xkcd.com/927", read as
 * https). Trailing punctuation and unbalanced closing brackets are left out.
 */
export function urlsInText(text: string): string[] {
  const urls: string[] = [];
  const rest = text.replace(URL_IN_TEXT, (url) => {
    urls.push(trimUrl(url, true));
    return ' ';
  });
  for (const match of rest.matchAll(SCHEMELESS)) urls.push(`https://${trimUrl(match[0], true)}`);
  return [...new Set(urls)];
}

/** How an item links to the page: its closest link, and that link's tier. */
export interface PageLink {
  url: string;
  tier: Tier;
}

const TIER_RANK: Record<Tier, number> = { same: 0, exact: 1, similar: 2 };

/** Whether `a` matches the page more closely than `b`. */
export const closerLink = (a: PageLink, b: PageLink | undefined): boolean =>
  b === undefined || TIER_RANK[a.tier] < TIER_RANK[b.tier];

/**
 * The items that link to the page, by index, given each item's links. All links are classified in
 * one batch, like submitted URLs, so the SIMILAR fan-out guard sees every one of them. Each item
 * keeps its closest link (the first of equals).
 */
export function linkingItems(
  links: ReadonlyArray<readonly string[]>,
  page: UrlKeys,
): Map<number, PageLink> {
  const candidates = links.flatMap((list, index) => list.map((url) => ({ url, index })));
  const best = new Map<number, PageLink>();
  for (const { url, index, tier } of classifyHits(candidates, [page])) {
    if (closerLink({ url, tier }, best.get(index))) best.set(index, { url, tier });
  }
  return best;
}

/** Decodes character references in one pass, so "&amp;#x2F;" becomes "&#x2F;" and stops there. */
function decodeEntities(s: string): string {
  return s.replace(
    ENTITY,
    (match: string, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
      if (name !== undefined) return NAMED_ENTITIES[name.toLowerCase()] ?? match;
      const code = hex === undefined ? Number.parseInt(dec ?? '', 10) : Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    },
  );
}

/**
 * Drops closing brackets with no opening one at the end ("(see https://e.com/a)"), and with
 * `punctuation` also the punctuation that ends a sentence. Linear in the URL's length.
 */
function trimUrl(url: string, punctuation: boolean): string {
  const open = { ')': count(url, '('), ']': count(url, '[') };
  const close = { ')': count(url, ')'), ']': count(url, ']') };
  let end = url.length;
  while (end > 0) {
    const last = url.charAt(end - 1);
    if (last === ')' || last === ']') {
      if (close[last] <= open[last]) break;
      close[last] -= 1;
    } else if (!punctuation || !TRAILING.includes(last)) {
      break;
    }
    end -= 1;
  }
  return url.slice(0, end);
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n += 1;
  return n;
}
