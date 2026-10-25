// Display and link helpers for the popup. Pure.

import { HN_ORIGIN, redditOrigin, type RedditHost } from '@/core/links';
import { computeKeys } from '@/core/url';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Compact age for a meta line: "now", "5 min", "3 hr", "1 day", "4 days", "2 wk", "5 mo", "3 yr". */
export function shortAge(epochMs: number, now: number): string {
  const age = Math.max(0, now - epochMs);
  if (age < MINUTE) return 'now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min`;
  if (age < DAY) return `${Math.floor(age / HOUR)} hr`;
  if (age < WEEK) {
    const days = Math.floor(age / DAY);
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (age < MONTH) return `${Math.floor(age / WEEK)} wk`;
  if (age < YEAR) return `${Math.floor(age / MONTH)} mo`;
  return `${Math.floor(age / YEAR)} yr`;
}

const FULL_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The full date and time, in the user's locale, for tooltips. */
export function fullDate(epochMs: number): string {
  return FULL_DATE.format(epochMs);
}

const GROUPED = new Intl.NumberFormat('en-US');

/** "1,008". */
export function grouped(n: number): string {
  return GROUPED.format(n);
}

export function plural(n: number, one: string, many: string): string {
  return `${grouped(n)} ${n === 1 ? one : many}`;
}

/** A URL without its scheme, a leading "www." or a lone trailing slash, for reading. */
export function readableUrl(url: string): string {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^([^/?#]+)\/$/, '$1');
}

/** A run of a submitted URL, where it starts, and whether it differs from the looked-up page. */
export interface UrlPart {
  text: string;
  start: number;
  diff: boolean;
}

/**
 * `url` in readable form, split into runs that match `page` and runs that differ, so the difference
 * can be emphasized. The host and the rest are compared separately, so a different subdomain and an
 * extra query parameter both stand out ("m.example.com/a?page=2" against "example.com/a").
 */
export function urlDifference(url: string, page: string): UrlPart[] {
  const [hostA, restA] = splitHost(readableUrl(url));
  const [hostB, restB] = splitHost(readableUrl(page));
  const runs = [...diffRuns(hostA, hostB), ...diffRuns(restA, restB)];
  // Merge neighbours of the same kind, so the markup stays flat.
  const merged: UrlPart[] = [];
  let start = 0;
  for (const run of runs) {
    const last = merged.at(-1);
    if (last?.diff === run.diff) last.text += run.text;
    else if (run.text !== '') merged.push({ ...run, start });
    start += run.text.length;
  }
  return merged;
}

function splitHost(url: string): [host: string, rest: string] {
  const end = url.search(/[/?#]/);
  return end === -1 ? [url, ''] : [url.slice(0, end), url.slice(end)];
}

/** `a` as its common start with `b`, the part that differs, and its common end with `b`. */
function diffRuns(a: string, b: string): Array<Omit<UrlPart, 'start'>> {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end += 1;
  }
  return [
    { text: a.slice(0, start), diff: false },
    { text: a.slice(start, a.length - end), diff: true },
    { text: a.slice(a.length - end), diff: false },
  ];
}

/** Time left until `epochMs`, for "try again in ..." lines: "40 s", "3 min". */
export function countdown(epochMs: number, now: number): string {
  const seconds = Math.max(1, Math.ceil((epochMs - now) / 1000));
  return seconds < 90 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
}

/**
 * Submit links for a page nobody has posted yet. Tracking parameters are removed from the URL first,
 * so a submission never carries them.
 */
export function submitUrls(
  url: string,
  title: string,
  host: RedditHost,
): { hn: string; reddit: string } {
  const clean = computeKeys(url)?.cleaned ?? url;
  const u = encodeURIComponent(clean);
  const t = encodeURIComponent(title);
  return {
    hn: `${HN_ORIGIN}/submitlink?u=${u}&t=${t}`,
    reddit: `${redditOrigin(host)}/submit?url=${u}&title=${t}`,
  };
}
