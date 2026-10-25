// Wrappers whose target is in the URL itself: AMP viewers and caches, web archives and redirect
// shims. Short links (t.co, bit.ly) need a request to resolve and are left alone; the tab URL is
// normally the resolved target already. Pure, no browser APIs.

import { decodeComponentSafe, hostOf, parseHttp } from './common';

/** Returns the wrapped target, or undefined when `url` is not this kind of wrapper. */
type Unwrapper = (url: URL, host: string) => string | undefined;

function param(url: URL, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (value) return value;
  }
  return undefined;
}

/** A URL embedded in a path: may be percent-encoded, have a collapsed "//", or lack a scheme. */
function embeddedUrl(text: string): string {
  let s = /^https?%3A/i.test(text) ? decodeComponentSafe(text) : text;
  s = s.replace(/^(https?):\/(?!\/)/i, '$1://');
  if (!/^https?:\/\//i.test(s) && /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(s)) {
    s = `http://${s}`;
  }
  return s;
}

const GOOGLE = /^google\.[a-z.]+$/;
const AMP_CACHE_PARAMS = [
  'amp_js_v',
  'amp_gsa',
  'usqp',
  'amp_r',
  'amp_tf',
  'aoh',
  'csi',
  'referrer',
];

const UNWRAPPERS: Unwrapper[] = [
  // Google AMP viewer: /amp/s/<host>/<path> (https) or /amp/<host>/<path> (http).
  (url, host) => {
    if (!GOOGLE.test(host)) return undefined;
    const m = /^\/amp\/(s\/)?(.+)$/.exec(url.pathname);
    return m ? `${m[1] ? 'https' : 'http'}://${m[2]}${url.search}` : undefined;
  },
  // Google redirect: /url?q= or /url?url=
  (url, host) =>
    GOOGLE.test(host) && url.pathname === '/url' ? param(url, 'q', 'url') : undefined,
  // AMP cache: <x>.cdn.ampproject.org/c/s/<host>/<path>
  (url, host) => {
    if (host !== 'cdn.ampproject.org' && !host.endsWith('.cdn.ampproject.org')) return undefined;
    const m = /^\/[cvi]\/(s\/)?(.+)$/.exec(url.pathname);
    if (!m) return undefined;
    const search = new URLSearchParams(url.search);
    for (const name of AMP_CACHE_PARAMS) search.delete(name);
    const query = search.toString();
    return `${m[1] ? 'https' : 'http'}://${m[2]}${query ? `?${query}` : ''}`;
  },
  // Facebook, Instagram and Messenger link shims.
  (url, host) =>
    /^(?:(?:l|lm|m)\.)?facebook\.com$|^l\.(?:instagram|messenger)\.com$/.test(host) &&
    /^\/(?:l\.php)?$/.test(url.pathname)
      ? param(url, 'u')
      : undefined,
  (url, host) => (host === 'out.reddit.com' ? param(url, 'url') : undefined),
  (url, host) =>
    host === 'youtube.com' && url.pathname === '/redirect' ? param(url, 'q') : undefined,
  (url, host) =>
    /^(?:r\.)?duckduckgo\.com$/.test(host) && url.pathname.startsWith('/l/')
      ? param(url, 'uddg')
      : undefined,
  (url, host) => (host === 'slack-redir.net' ? param(url, 'url') : undefined),
  (url, host) =>
    host === 'steamcommunity.com' && url.pathname.startsWith('/linkfilter')
      ? param(url, 'url', 'u')
      : undefined,
  // Wayback Machine: /web/<timestamp><modifier like id_ or if_>/<url>
  (url, host) => {
    if (!/^(?:web\.|wayback\.)?archive\.org$/.test(host)) return undefined;
    const m = /^\/web\/\d{1,14}(?:[a-z]{2}_|\*)?\/(.+)$/.exec(url.pathname);
    return m?.[1] ? embeddedUrl(m[1]) + url.search : undefined;
  },
  // archive.today long form. Short ids (archive.ph/AbCdE) need the page itself.
  (url, host) => {
    if (!/^archive\.(?:today|ph|is|li|vn|fo|md)$/.test(host)) return undefined;
    const m = /^\/(?:\d{4}\.\d{2}\.\d{2}-\d{6}|\d{14}|o\/[A-Za-z0-9]+|newest|oldest)\/(.+)$/.exec(
      url.pathname,
    );
    return m?.[1] ? embeddedUrl(m[1]) + url.search : undefined;
  },
];

/** Follows wrappers up to `maxDepth` levels; returns `input` itself when it wraps nothing. */
export function unwrap(input: URL, maxDepth = 5): URL {
  let current = input;
  for (let depth = 0; depth < maxDepth; depth++) {
    const host = hostOf(current).replace(/^www\./, '');
    let target: URL | null = null;
    for (const unwrapper of UNWRAPPERS) {
      const next = unwrapper(current, host);
      if (next !== undefined) {
        target = parseHttp(next);
        break;
      }
    }
    if (!target) break;
    current = target;
  }
  return current;
}
