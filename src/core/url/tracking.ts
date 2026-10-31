// Query parameters that only track (removed from every key) and parameters that look secret (never
// sent anywhere). The tracking names come from tracking-params.generated.json, which is generated
// from MPL-2.0 lists by scripts/build-tracking-list.mjs, plus a few the lists lack (UNLISTED). Pure,
// no browser APIs.

import TRACKING from './tracking-params.generated.json';

interface HostPattern {
  host: string;
  /** Also matches subdomains. */
  sub: boolean;
  /** Matched against path + query. */
  path?: RegExp;
}

interface SiteEntry {
  patterns: HostPattern[];
  params: ReadonlySet<string>;
}

const GLOBAL: ReadonlySet<string> = new Set(TRACKING.global);
const PREFIXES: readonly string[] = TRACKING.prefixes;

/** Chrome match-pattern style glob ("/search?*") as an anchored regular expression. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.*')}$`);
}

/** "*.example.com/path*" -> pattern. A leading "www." is optional on both sides. */
function parseHostPattern(text: string): HostPattern {
  const slash = text.indexOf('/');
  let host = slash < 0 ? text : text.slice(0, slash);
  const sub = host.startsWith('*.');
  if (sub) host = host.slice(2);
  host = host.replace(/^www\./, '');
  return slash < 0 ? { host, sub } : { host, sub, path: globToRegExp(text.slice(slash)) };
}

// Site entries indexed by host so a lookup costs a few map reads, not a scan of every rule.
const BY_HOST = new Map<string, SiteEntry[]>();
const BY_DOMAIN = new Map<string, SiteEntry[]>();
for (const site of TRACKING.sites) {
  const entry: SiteEntry = {
    patterns: site.hosts.map(parseHostPattern),
    params: new Set(site.params),
  };
  for (const p of entry.patterns) {
    const index = p.sub ? BY_DOMAIN : BY_HOST;
    const list = index.get(p.host) ?? [];
    if (!list.includes(entry)) list.push(entry);
    index.set(p.host, list);
  }
}

function patternMatches(p: HostPattern, host: string, pathAndQuery: string): boolean {
  const hostOk = host === p.host || (p.sub && host.endsWith(`.${p.host}`));
  return hostOk && (!p.path || p.path.test(pathAndQuery));
}

/** Site-specific tracking names that apply to one URL. */
function siteParams(host: string, pathAndQuery: string): Set<string> {
  const bare = host.replace(/^www\./, '');
  const candidates = new Set(BY_HOST.get(bare));
  const labels = bare.split('.');
  for (let i = 0; i < labels.length; i++) {
    for (const entry of BY_DOMAIN.get(labels.slice(i).join('.')) ?? []) candidates.add(entry);
  }
  const names = new Set<string>();
  for (const entry of candidates) {
    if (entry.patterns.some((p) => patternMatches(p, bare, pathAndQuery))) {
      for (const n of entry.params) names.add(n);
    }
  }
  return names;
}

const SESSION_NAMES = new Set([
  'sid',
  'phpsessid',
  'jsessionid',
  'sessionid',
  'session_id',
  'cfid',
  'cftoken',
  'oscsid',
  'zenid',
]);

/**
 * Session ids. Only `sid` needs its value checked, since it is a story id on some sites (Slashdot's
 * `article.pl?sid=07/04/25/1953246`); the other names are session ids whatever their format.
 */
function isSessionId(name: string, value: string): boolean {
  if (!SESSION_NAMES.has(name)) return false;
  return name !== 'sid' || /^[0-9a-f]{26,40}$/i.test(value);
}

/**
 * Tracking names missing from Brave's and Firefox's lists, each with the shape of the values it
 * tracks with, so a site that uses the name for something else keeps it. trueAnthem, which news
 * sites use to post to social media, adds `taid` (a 24-digit hex id) next to its utm_ parameters.
 */
const UNLISTED: ReadonlyMap<string, RegExp> = new Map([['taid', /^[0-9a-f]{24}$/i]]);

/**
 * Returns a predicate that tells whether a query parameter of this URL only tracks. `host` is the
 * lowercased host (with "www." if present), `pathAndQuery` the raw path plus search string.
 */
export function trackingFilter(
  host: string,
  pathAndQuery: string,
  extra: readonly string[] = [],
): (name: string, value: string) => boolean {
  const site = siteParams(host, pathAndQuery);
  for (const n of extra) site.add(n);
  return (name, value) => {
    const n = name.toLowerCase();
    return (
      GLOBAL.has(n) ||
      site.has(n) ||
      PREFIXES.some((p) => n.startsWith(p)) ||
      UNLISTED.get(n)?.test(value) === true ||
      isSessionId(n, value)
    );
  };
}

const SECRET_NAMES = new Set([
  'token',
  'key',
  'apikey',
  'sig',
  'signature',
  'code',
  'auth',
  'authkey',
  'session',
  'password',
  'passwd',
  'pwd',
  'pass',
  'secret',
  'otp',
  'nonce',
  'hmac',
  'jwt',
  'ticket',
  'email',
]);
const SECRET_PATTERN =
  /token$|secret$|passw(?:or)?d$|^(?:api|access|private|secret|client|auth|signing)[_-]?key$|[_-]sig(?:nature)?$|^x-(?:amz|goog)-|^session[_-]?id$/;

/**
 * Parameters that may carry credentials or personal data (and session ids). They are removed
 * before a URL is sent anywhere and never appear in the `cleaned` or `similar` keys.
 */
export function isSecretParam(name: string, value = ''): boolean {
  const n = name.toLowerCase();
  return SECRET_NAMES.has(n) || SECRET_PATTERN.test(n) || isSessionId(n, value);
}
