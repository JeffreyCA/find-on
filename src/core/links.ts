// Thread, sign-in and site URL builders and venue labels. Pure TS, no browser APIs.
//
// Remote data (ids, permalinks, names) only ever lands in a path or query of a fixed origin, so a
// crafted value can't turn a link into one that leaves news.ycombinator.com or reddit.com.

import type { Discussion } from './types';
import { registrableLabels } from './url/common';

export type RedditHost = 'www' | 'old';

export const HN_ORIGIN = 'https://news.ycombinator.com';

export function redditOrigin(host: RedditHost): string {
  return host === 'old' ? 'https://old.reddit.com' : 'https://www.reddit.com';
}

export function threadUrl(d: Discussion, host: RedditHost): string {
  if (d.source === 'hn') return `${HN_ORIGIN}/item?id=${encodeURIComponent(d.id)}`;
  const origin = redditOrigin(host);
  // Permalinks are site-relative ("/r/sub/comments/id/slug/"); anything else falls back to the id.
  if (d.permalink.startsWith('/') && !d.permalink.startsWith('//')) {
    const url = new URL(d.permalink, origin);
    if (url.origin === origin) return url.href;
  }
  return `${origin}/comments/${encodeURIComponent(d.id)}/`;
}

/** "HN", "r/programming", or "u/name" for a post to a user's profile. */
export function venueLabel(d: Discussion): string {
  if (d.source === 'hn') return 'HN';
  const profile = profileOf(d);
  return profile === undefined ? `r/${d.venue}` : `u/${profile}`;
}

/** The author, unless the venue already names them (a post to their own profile); '' for none. */
export function authorLabel(d: Discussion): string {
  return profileOf(d)?.toLowerCase() === d.author.toLowerCase() ? '' : d.author;
}

function profileOf(d: Discussion): string | undefined {
  return d.source === 'reddit' ? /^u_(.+)$/.exec(d.venue)?.[1] : undefined;
}

export function redditLoginUrl(host: RedditHost): string {
  return `${redditOrigin(host)}/login`;
}

/**
 * Every HN submission from the page's site (its registrable domain), for pages whose results may be
 * incomplete. Null for URLs that can't be parsed.
 */
export function hnSiteUrl(url: string): { url: string; site: string } | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
  if (!hostname.includes('.')) return null;
  const site = hostname.split('.').slice(-registrableLabels(hostname)).join('.');
  return { url: `${HN_ORIGIN}/from?site=${encodeURIComponent(site)}`, site };
}
