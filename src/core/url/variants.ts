// Spellings of a page URL for Reddit's exact-URL index (/api/info.json?url=). Pure, no browser APIs.

import { registrableLabels } from './common';
import { computeKeys, splitIdentity } from './keys';

const TWITTER_STATUS = /^\/([A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status(?:es)?\/(\d+)/;

function toggleSlash(url: URL, fileLike: boolean): string | undefined {
  if (url.pathname === '/' || fileLike) return undefined;
  const v = new URL(url.href);
  v.pathname = v.pathname.endsWith('/') ? v.pathname.replace(/\/+$/, '') : `${v.pathname}/`;
  return v.href;
}

function toggleScheme(url: URL): string {
  const v = new URL(url.href);
  v.protocol = v.protocol === 'https:' ? 'http:' : 'https:';
  return v.href;
}

/** Adds or removes "www.", only where "www." is plausible (never "www.blog.example.com"). */
function toggleWww(url: URL): URL | undefined {
  const host = url.hostname;
  let next: string;
  if (host.startsWith('www.')) next = host.slice(4);
  else if (host.split('.').length === registrableLabels(host)) next = `www.${host}`;
  else return undefined;
  const v = new URL(url.href);
  v.hostname = next;
  return v;
}

/**
 * Candidate URLs for Reddit's exact-URL lookup, most likely first, at most `budget`. Reddit keys on
 * the submitted string, so identity sites get the spellings people paste, and other pages get the
 * cleaned URL (for GitHub, the repository root first) followed by scheme, trailing-slash and "www."
 * toggles.
 */
export function redditVariants(url: string, budget = 3): string[] {
  const keys = computeKeys(url);
  if (!keys || budget <= 0) return [];
  const out = new Set<string>();
  const add = (v: string | undefined) => {
    if (v) out.add(v);
  };
  const [kind, id] = splitIdentity(keys.identity);

  if (kind === 'youtube') {
    add(`https://www.youtube.com/watch?v=${id}`);
    add(`https://youtu.be/${id}`);
    add(`https://m.youtube.com/watch?v=${id}`);
    add(`https://youtube.com/watch?v=${id}`);
  } else if (kind === 'twitter') {
    // Keep the handle as the user sees it; Reddit may not fold case.
    const m = TWITTER_STATUS.exec(new URL(keys.cleaned).pathname);
    const path = m ? `/${m[1]}/status/${m[2]}` : `/i/status/${id}`;
    add(`https://x.com${path}`);
    add(`https://twitter.com${path}`);
    add(`https://mobile.twitter.com${path}`);
  } else if (kind === 'arxiv') {
    add(`https://arxiv.org/abs/${id}`);
    add(`https://arxiv.org/pdf/${id}`);
    add(keys.cleaned);
  } else {
    let base = new URL(keys.cleaned);
    if (kind === 'github') {
      // A default-branch tree page is the repository, which people submit by its root. The root is
      // taken from the page, not the lowercased identity: Reddit keys on the spelling as submitted.
      const [owner = '', repo = ''] = base.pathname.split('/').filter(Boolean);
      const root = new URL(`/${owner}/${repo.replace(/\.git$/i, '')}`, base.origin);
      add(root.href);
      add(base.href);
      base = root;
    }
    const fileLike = /\.[a-z0-9]{2,5}$/i.test(base.pathname);
    add(base.href);
    // Most http pages moved to https; older submissions keep http.
    if (base.protocol === 'http:') add(toggleScheme(base));
    add(toggleSlash(base, fileLike));
    const www = toggleWww(base);
    if (www) {
      add(www.href);
      add(toggleSlash(www, fileLike));
    }
    if (base.protocol === 'https:') add(toggleScheme(base));
  }
  return [...out].slice(0, budget);
}
