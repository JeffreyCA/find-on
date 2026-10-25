// Small URL helpers shared by the URL modules. Pure, no browser APIs.

/** Parses an absolute http(s) URL, or returns null. */
export function parseHttp(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function decodeComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Lowercased host without a trailing dot. */
export function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

/** Strips "www." / "wwwN." when at least two labels remain (Reddit's strip_www rule). */
export function stripWww(host: string): string {
  return /^www\d*\./.test(host) && host.split('.').length > 2
    ? host.replace(/^www\d*\./, '')
    : host;
}

/** Number of labels in the registrable domain: 3 for "co.uk"-style suffixes, else 2 (heuristic). */
export function registrableLabels(host: string): number {
  const labels = host.split('.');
  const tld = labels.at(-1) ?? '';
  const sld = labels.at(-2) ?? '';
  return labels.length >= 3 && tld.length === 2 && sld.length <= 3 ? 3 : 2;
}

export interface QueryParam {
  /** Decoded name ("+" read as a space). */
  name: string;
  /** Decoded value ("+" read as a space). */
  value: string;
  /** The segment as it appeared in the URL. */
  raw: string;
}

const decodeFormComponent = (s: string) => decodeComponentSafe(s.replaceAll('+', ' '));

/** Splits a `?a=1&b=2` search string. "&amp;" (URLs copied out of HTML) counts as "&". */
export function splitQuery(search: string): QueryParam[] {
  if (search.length <= 1) return [];
  return search
    .slice(1)
    .replace(/&amp;/gi, '&')
    .split('&')
    .filter(Boolean)
    .map((raw) => {
      const eq = raw.indexOf('=');
      return eq < 0
        ? { name: decodeFormComponent(raw), value: '', raw }
        : {
            name: decodeFormComponent(raw.slice(0, eq)),
            value: decodeFormComponent(raw.slice(eq + 1)),
            raw,
          };
    });
}

const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

/**
 * Normalizes percent-encoding without changing meaning: hex upper-cased, escapes of unreserved
 * characters decoded, reserved escapes kept, and non-ASCII text in NFC (so "e" + U+0301 and
 * U+00E9 give the same key).
 */
export function pctNormalize(s: string): string {
  // 1. Decode escapes of non-ASCII and unreserved characters; keep (upper-cased) reserved escapes.
  const decoded = s.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    let text: string;
    try {
      text = decodeURIComponent(run);
    } catch {
      // Not valid UTF-8: normalize byte by byte.
      return run.replace(/%([0-9A-Fa-f]{2})/g, (_m, hex: string) => {
        const c = String.fromCharCode(Number.parseInt(hex, 16));
        return UNRESERVED.test(c) ? c : `%${hex.toUpperCase()}`;
      });
    }
    let out = '';
    for (const c of text) {
      if (c.charCodeAt(0) >= 0x80 || UNRESERVED.test(c)) out += c;
      else out += `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
    }
    return out;
  });
  // 2. Compose, then re-encode non-ASCII (encodeURIComponent emits upper-case hex).
  return decoded.normalize('NFC').replace(/[\u0080-\u{10FFFF}]+/gu, (t) => encodeURIComponent(t));
}

// Characters never decoded for display: controls, format characters (bidi overrides, zero-width),
// separators and unassigned code points, as browsers do for the address bar.
const DISPLAY_UNSAFE = /[\p{C}\p{Z}]/u;

/** Decodes percent-encoded non-ASCII text for display ("caf%C3%A9" -> "café"). */
export function decodeForDisplay(s: string): string {
  return s.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    let text: string;
    try {
      text = decodeURIComponent(run);
    } catch {
      return run;
    }
    let out = '';
    for (const c of text) {
      out += c.charCodeAt(0) >= 0x80 && !DISPLAY_UNSAFE.test(c) ? c : encodeURIComponent(c);
    }
    return out;
  });
}
