// Which pages may be looked up at all, and the sanitized URL to use. Pure, no browser APIs.

import { hostOf, splitQuery } from './common';
import { hashRoute } from './keys';
import { isSecretParam } from './tracking';
import { unwrap } from './unwrap';

/** `ok.url` is sanitized: fragment (except `#!` and `#/` routes) and secret-looking params removed. */
export type Eligibility =
  | { ok: true; url: string }
  | { ok: false; reason: 'unsupported' | 'private' | 'invalid' };

/** Reserved, special-use and intranet suffixes that never resolve publicly. */
const PRIVATE_SUFFIXES = [
  'local',
  'localhost',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home',
  'home.arpa',
  'corp',
  'private',
  'test',
  'example',
  'invalid',
  'onion',
];

function isPrivateHost(host: string): boolean {
  return (
    !host.includes('.') || // single label, including "localhost"
    host.startsWith('[') || // IPv6 literal
    /^\d+\.\d+\.\d+\.\d+$/.test(host) || // IPv4 literal (the URL parser normalizes other forms)
    PRIVATE_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  );
}

function isPrivate(url: URL): boolean {
  return url.username !== '' || url.password !== '' || isPrivateHost(hostOf(url));
}

/**
 * Only public http(s) pages are looked up. URLs with credentials, IP literals, single-label hosts
 * and private-use domains are "private", and so are wrappers around such a URL (a redirect shim or
 * an archive copy: the lookup sends the wrapped URL). Other schemes (chrome:, file:, about:) are
 * "unsupported".
 */
export function checkEligibility(input: string): Eligibility {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported' };
  }
  if (isPrivate(url) || isPrivate(unwrap(url))) return { ok: false, reason: 'private' };
  url.hash = hashRoute(url.hash);
  const params = splitQuery(url.search);
  const kept = params.filter((p) => !isSecretParam(p.name, p.value));
  if (kept.length !== params.length) {
    url.search = kept.length > 0 ? `?${kept.map((p) => p.raw).join('&')}` : '';
  }
  return { ok: true, url: url.href };
}
