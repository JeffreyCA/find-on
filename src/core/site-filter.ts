// Block/allow site patterns for automatic checks. Pure TS, no browser APIs.
//
// Pattern syntax, one per line, case-insensitive; blank lines and "#" comments are ignored:
//   example.com        that host and all its subdomains
//   example.com/path   additionally, the URL path starts with "/path"
//   *.example.com      same as example.com
//   example.*          example.com, example.de, example.co.uk and so on (any public suffix)
// For convenience a pasted URL is accepted too: the scheme, "www.", query and fragment are ignored.

import { registrableLabels } from './url/common';

export interface SiteFilter {
  mode: 'block' | 'allow';
  block: string[];
  allow: string[];
}

export interface ParsedPattern {
  /** The pattern text as written (without comment). */
  raw: string;
  /** Lowercased ASCII host without "www."; without its suffix when `anySuffix`. */
  host: string;
  /** The pattern ended in ".*": `host` may be followed by any public suffix. */
  anySuffix: boolean;
  /** Lowercased path prefix without a trailing slash, "" for the whole host. */
  path: string;
}

function parsePattern(raw: string): ParsedPattern | null {
  let s = raw
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[?#].*$/, '');
  if (s.startsWith('*.')) s = s.slice(2);
  const slash = s.indexOf('/');
  let hostText = slash < 0 ? s : s.slice(0, slash);
  const anySuffix = hostText.endsWith('.*');
  if (anySuffix) hostText = hostText.slice(0, -2);
  // "path/*" means the same as "path".
  const pathText = slash < 0 ? '' : s.slice(slash).replace(/\/?\*$/, '');
  // Ports, credentials, IPv6 literals and wildcards inside the pattern are not supported.
  if (!/^[^\s*/:@[\]]+$/.test(hostText) || /[\s*]/.test(pathText)) return null;
  let url: URL;
  try {
    url = new URL(`http://${hostText}${pathText}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/\.$/, '').replace(/^www\./, '');
  if (!anySuffix && !host.includes('.')) return null;
  const path = pathText ? url.pathname.toLowerCase().replace(/\/+$/, '') : '';
  return { raw, host, anySuffix, path };
}

/** Parses pattern lines (entries may also contain newlines). Invalid lines are returned as written. */
export function parsePatterns(lines: readonly string[]): {
  patterns: ParsedPattern[];
  invalid: string[];
} {
  const patterns: ParsedPattern[] = [];
  const invalid: string[] = [];
  for (const line of lines.flatMap((entry) => entry.split(/\r?\n/))) {
    const text = line.replace(/(?:^|\s)#.*$/, '').trim();
    if (!text) continue;
    const pattern = parsePattern(text);
    if (pattern) patterns.push(pattern);
    else invalid.push(line.trim());
  }
  return { patterns, invalid };
}

function matches(pattern: ParsedPattern, host: string, path: string): boolean {
  const name = pattern.anySuffix ? withoutSuffix(host) : host;
  const hostMatches = name === pattern.host || name.endsWith(`.${pattern.host}`);
  return hostMatches && path.startsWith(pattern.path);
}

/** The host without its public suffix: "www.google" for www.google.co.uk. */
function withoutSuffix(host: string): string {
  return host
    .split('.')
    .slice(0, 1 - registrableLabels(host))
    .join('.');
}

/**
 * Whether `url` may be checked automatically: in block mode unless a block pattern matches, in
 * allow mode only when an allow pattern matches. Governs automatic checks only; a manual click
 * always checks.
 */
export function isAllowedByFilter(url: string, filter: SiteFilter): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const path = parsed.pathname.toLowerCase();
  const allowMode = filter.mode === 'allow';
  const { patterns } = parsePatterns(allowMode ? filter.allow : filter.block);
  const listed = patterns.some((p) => matches(p, host, path));
  return allowMode ? listed : !listed;
}

/** Prefilled block list: mail, calendars, documents, sign-in, search, chat and AI assistants. */
export const DEFAULT_BLOCK_LIST: readonly string[] = [
  'mail.google.com',
  'calendar.google.com',
  'docs.google.com',
  'drive.google.com',
  'accounts.google.com',
  'google.*/search',
  'bing.com/search',
  'duckduckgo.com',
  'search.brave.com',
  'kagi.com/search',
  'search.yahoo.com',
  'ecosia.org/search',
  'startpage.com',
  'yandex.*/search',
  'youtube.com/results',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'login.microsoftonline.com',
  'teams.microsoft.com',
  'app.slack.com',
  'discord.com/channels',
  'web.whatsapp.com',
  'messenger.com',
  'chatgpt.com',
  'claude.ai',
  'gemini.google.com',
  'perplexity.ai',
];
