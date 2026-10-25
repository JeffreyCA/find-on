// Per-site knowledge: hosts that are the same site, content ids that identify a page however it is
// spelled (SAME tier), and site-specific tracking parameters. Pure, no browser APIs.

import { decodeComponentSafe, pctNormalize } from './common';

/** A URL split for keying. */
export interface Parts {
  /** Lowercased ASCII, no trailing dot, no "www.". */
  host: string;
  /** Non-default port or "". */
  port: string;
  /** Normalized path without a trailing slash ("" for the root). */
  path: string;
  /** Decoded name/value pairs, tracking removed, original order. */
  params: ReadonlyArray<readonly [string, string]>;
  /** "#/..." or "#!..." for hash-routed apps, else "". */
  route: string;
}

export interface SiteRule {
  /** Tested against the host without "www.". */
  hosts: RegExp;
  /** Same-resource rewrite applied to both the EXACT and SIMILAR keys. */
  rewrite?(p: Parts): Parts;
  /** Site identity, e.g. "youtube:dQw4w9WgXcQ". Equal identities are the SAME tier. */
  identity?(p: Parts): string | undefined;
  /** Lowercased query parameters that carry identity here; SIMILAR keeps only these. */
  similarParams?: readonly string[];
  /** SIMILAR-only rewrite, applied before the generic SIMILAR folds. */
  similar?(p: Parts): Parts;
  /** Paths are literal (code hosts serve real files named index.html or amp). */
  literalPaths?: boolean;
  /** Lowercased tracking parameters on top of the generated list. */
  tracking?: readonly string[];
}

const get = (p: Parts, name: string) => p.params.find(([k]) => k === name)?.[1];
const segments = (path: string) => path.split('/').filter(Boolean);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const ARXIV_NEW = /^(\d{4}\.\d{4,5})(v\d+)?$/;
const ARXIV_OLD = /^([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?$/;
const TWITTER_STATUS = /^\/(?:([A-Za-z0-9_]{1,15})|i(?:\/web)?)\/status(?:es)?\/(\d+)/;
const REDDIT_POST = /^(?:\/(?:r|u|user)\/[^/]+)?\/comments\/([a-z0-9]+)(?:\/|$)/;

/** Navigation state on news.ycombinator.com pages. */
const HN_NOISE = new Set(['goto', 'fnid', 'fnop']);

const GITHUB_RESERVED = new Set([
  'orgs',
  'users',
  'settings',
  'marketplace',
  'explore',
  'topics',
  'collections',
  'sponsors',
  'features',
  'apps',
  'search',
  'notifications',
  'login',
  'about',
  'pricing',
  'enterprise',
  'trending',
]);

/** MediaWiki title encoding: spaces as underscores, first letter upper-cased (except Wiktionary). */
function encodeTitle(title: string, capitalize: boolean): string {
  const t = title.replaceAll(' ', '_');
  const cased = capitalize ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  // MediaWiki leaves these readable in its own links.
  const encoded = encodeURIComponent(cased).replace(/%(?:3B|40|24|2C|2F|3A)/g, decodeURIComponent);
  return pctNormalize(encoded);
}

export const SITE_RULES: readonly SiteRule[] = [
  // YouTube
  {
    hosts: /^(?:(?:m|music|gaming)\.)?youtube\.com$|^youtu\.be$|^youtube-nocookie\.com$/,
    tracking: [
      'si',
      'pp',
      'feature',
      'ab_channel',
      'source_ve_path',
      'embeds_euri',
      'embeds_origin',
      'embeds_referring_euri',
      'embeds_referring_origin',
    ],
    rewrite(p) {
      const seg = segments(p.path);
      let id: string | undefined;
      if (p.host === 'youtu.be') id = seg[0];
      else if (seg[0] === 'watch') id = get(p, 'v');
      else if (['shorts', 'embed', 'live', 'v', 'e'].includes(seg[0] ?? '')) id = seg[1];
      if (id && YOUTUBE_ID.test(id)) {
        return { ...p, host: 'youtube.com', path: '/watch', params: [['v', id]] };
      }
      // Other pages: fold the host aliases and keep only parameters that pick content.
      const keep = new Set(['list', 'search_query', 'v']);
      return { ...p, host: 'youtube.com', params: p.params.filter(([k]) => keep.has(k)) };
    },
    identity(p) {
      const v = get(p, 'v');
      if (p.path === '/watch' && v) return `youtube:${v}`;
      const list = get(p, 'list');
      return p.path === '/playlist' && list ? `youtube-list:${list}` : undefined;
    },
    similarParams: ['v', 'list', 'search_query'],
    // Channel tabs fold to the channel.
    similar: (p) => ({
      ...p,
      path: p.path.replace(
        /^(\/@[^/]+|\/(?:channel|c|user)\/[^/]+)\/(?:videos|featured|streams|shorts|playlists|community|about|posts)$/,
        '$1',
      ),
    }),
  },
  // Twitter / X and its mirrors
  {
    hosts:
      /^(?:(?:mobile|m)\.)?(?:twitter|x)\.com$|^(?:fx|vx|fixv|fixup)twitter\.com$|^(?:fixup|fixv)x\.com$|^xcancel\.com$|^nitter\.(?:net|poast\.org|privacydev\.net)$/,
    tracking: ['s', 't', 'ref_src', 'ref_url', 'cxt', 'src'],
    rewrite(p) {
      const m = TWITTER_STATUS.exec(p.path);
      if (m) {
        const user = (m[1] ?? 'i').toLowerCase();
        return { ...p, host: 'x.com', path: `/${user}/status/${m[2]}`, params: [] };
      }
      // Handles are case-insensitive.
      const path = p.path.replace(/^\/[A-Za-z0-9_]{1,15}(?=\/|$)/, (s) => s.toLowerCase());
      return { ...p, host: 'x.com', path };
    },
    identity(p) {
      const m = /\/status\/(\d+)$/.exec(p.path);
      return m ? `twitter:${m[1]}` : undefined;
    },
    similarParams: ['q'],
  },
  // Wikipedia
  {
    hosts:
      /^[a-z-]+\.(?:m\.)?(?:wikipedia|wiktionary|wikibooks|wikiquote|wikisource|wikivoyage|wikinews|wikiversity)\.org$/,
    // Titles are literal: /wiki/AMP and /wiki/Index.html are articles.
    literalPaths: true,
    tracking: ['wprov', 'useskin', 'uselang'],
    rewrite(p) {
      const host = p.host.replace('.m.', '.');
      const capitalize = !host.endsWith('.wiktionary.org');
      if (p.path === '/w/index.php') {
        const title = get(p, 'title');
        const versioned = p.params.some(([k]) =>
          ['oldid', 'diff', 'action', 'curid', 'search', 'printable'].includes(k),
        );
        if (title && !versioned) {
          return { ...p, host, path: `/wiki/${encodeTitle(title, capitalize)}`, params: [] };
        }
      }
      if (p.path.startsWith('/wiki/')) {
        const title = decodeComponentSafe(p.path.slice('/wiki/'.length));
        return { ...p, host, path: `/wiki/${encodeTitle(title, capitalize)}` };
      }
      return { ...p, host };
    },
    similarParams: ['search'],
    // Old revisions and diffs are other versions of the article.
    similar(p) {
      const title = get(p, 'title');
      if (p.path !== '/w/index.php' || !title) return p;
      const capitalize = !p.host.endsWith('.wiktionary.org');
      return { ...p, path: `/wiki/${encodeTitle(title, capitalize)}`, params: [] };
    },
  },
  // arXiv
  {
    hosts: /^(?:export\.)?arxiv\.org$/,
    rewrite(p) {
      const m = /^\/(abs|pdf|html|format|ps)\/(.+?)(?:\.pdf)?$/.exec(p.path);
      if (!m) return { ...p, host: 'arxiv.org' };
      return { ...p, host: 'arxiv.org', path: `/${m[1]}/${m[2]}`, params: [] };
    },
    // The version is dropped: v1 and v7 are the same paper.
    identity(p) {
      const m = /^\/(?:abs|pdf|html|format|ps)\/(.+)$/.exec(p.path);
      if (!m?.[1]) return undefined;
      const id = ARXIV_NEW.exec(m[1])?.[1] ?? ARXIV_OLD.exec(m[1])?.[1];
      return id ? `arxiv:${id}` : undefined;
    },
  },
  // GitHub
  {
    hosts: /^github\.com$/,
    literalPaths: true,
    tracking: ['tab', 'notification_referrer_id', 'email_source'],
    // Owner and repository names are case-insensitive; ".git" clone URLs are the repository.
    rewrite(p) {
      const seg = segments(p.path);
      const [owner, repo] = seg;
      if (owner !== undefined) seg[0] = owner.toLowerCase();
      if (repo !== undefined) seg[1] = repo.toLowerCase().replace(/\.git$/, '');
      return { ...p, path: seg.length > 0 ? `/${seg.join('/')}` : '' };
    },
    identity(p) {
      const seg = segments(p.path);
      const [owner = '', repo = '', kind, branch = ''] = seg;
      if (seg.length === 2 && !GITHUB_RESERVED.has(owner)) return `github:${owner}/${repo}`;
      if (seg.length === 4 && kind === 'tree' && /^(?:main|master|trunk|develop)$/.test(branch)) {
        return `github:${owner}/${repo}`;
      }
      return undefined;
    },
    similarParams: ['q'],
  },
  // Medium
  {
    hosts: /^(?:[a-z0-9-]+\.)?medium\.com$/,
    tracking: ['source', 'sk', 'gi'],
    // Post ids end the slug ("my-post-title-1a2b3c4d5e6f") or stand alone ("/p/1a2b3c4d5e6f").
    identity(p) {
      const m = /(?:^|[/-])([0-9a-f]{10,12})$/.exec(p.path);
      return m ? `medium:${m[1]}` : undefined;
    },
  },
  // Substack
  {
    hosts: /^(?:[a-z0-9-]+\.)?substack\.com$/,
    tracking: [
      'r',
      's',
      'triedredirect',
      'showwelcome',
      'publication_id',
      'post_id',
      'isfreemail',
      'next',
    ],
  },
  // Reddit
  {
    hosts: /^(?:(?:old|new|np|m|i|amp|sh)\.)?reddit\.com$|^redd\.it$/,
    tracking: [
      'share_id',
      'rdt',
      'correlation_id',
      'ref',
      'ref_source',
      'ref_campaign',
      'context',
      'sort',
      '$deep_link',
      '$3p',
      '$original_url',
      '_branch_match_id',
      'post_index',
      'target_user',
      'post_fullname',
    ],
    rewrite(p) {
      if (p.host === 'redd.it') {
        const id = segments(p.path)[0];
        return id
          ? { ...p, host: 'reddit.com', path: `/comments/${id.toLowerCase()}`, params: [] }
          : { ...p, host: 'reddit.com' };
      }
      const m =
        /^(\/r\/[^/]+|\/u(?:ser)?\/[^/]+)?\/comments\/([a-z0-9]+)(\/[^/]*)?(\/[a-z0-9]+)?/i.exec(
          p.path,
        );
      if (m) {
        const [, owner = '', id = '', slug = '', comment = ''] = m;
        const path = `${owner.toLowerCase()}/comments/${id.toLowerCase()}${slug}${comment}`;
        return { ...p, host: 'reddit.com', path, params: [] };
      }
      return {
        ...p,
        host: 'reddit.com',
        path: p.path.replace(/^\/r\/[^/]+/i, (s) => s.toLowerCase()),
      };
    },
    // Comment permalinks belong to their post.
    identity(p) {
      const m = REDDIT_POST.exec(p.path);
      return m ? `reddit:${m[1]}` : undefined;
    },
    similar: (p) => ({
      ...p,
      path: p.path.replace(
        /^(?:\/(?:r|u|user)\/[^/]+)?\/comments\/([a-z0-9]+)(?:\/[^/]*)?$/,
        '/comments/$1',
      ),
    }),
  },
  // Hacker News
  {
    hosts: /^news\.ycombinator\.com$/,
    rewrite(p) {
      if (p.path === '/item') return { ...p, params: p.params.filter(([k]) => k === 'id') };
      return { ...p, params: p.params.filter(([k]) => !HN_NOISE.has(k)) };
    },
    identity(p) {
      const id = get(p, 'id');
      return p.path === '/item' && id && /^\d+$/.test(id) ? `hn:${id}` : undefined;
    },
    similarParams: ['id', 'site', 'p'],
  },
  // Stack Exchange
  {
    hosts:
      /^(?:stackoverflow\.com|serverfault\.com|superuser\.com|askubuntu\.com|mathoverflow\.net|[a-z0-9-]+\.stackexchange\.com)$/,
    tracking: ['noredirect', 'lq', 'rq'],
    identity(p) {
      const m = /^\/(?:questions|q)\/(\d+)/.exec(p.path);
      return m ? `${p.host}:q${m[1]}` : undefined;
    },
    similar: (p) => ({
      ...p,
      path: p.path.replace(/^\/(?:questions|q)\/(\d+)(?:\/.*)?$/, '/questions/$1'),
    }),
  },
  // Amazon
  {
    hosts:
      /^(?:smile\.)?amazon\.(?:com|ca|co\.uk|de|fr|it|es|co\.jp|in|com\.au|com\.br|com\.mx|nl|se|pl)$/,
    // A trailing "/ref=..." segment is click tracking.
    rewrite: (p) => ({
      ...p,
      host: p.host.replace(/^smile\./, ''),
      path: p.path.replace(/\/ref=[^/]*$/, ''),
    }),
    similar(p) {
      const m = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/.exec(p.path);
      return m ? { ...p, path: `/dp/${m[1]}` } : p;
    },
  },
  // LinkedIn
  {
    hosts: /^(?:[a-z]{2}\.)?linkedin\.com$/,
    tracking: [
      'trackingid',
      'refid',
      'lipi',
      'midtoken',
      'midsig',
      'trk',
      'trkemail',
      'originalsubdomain',
    ],
  },
  // Google Docs
  {
    hosts: /^(?:docs|drive)\.google\.com$/,
    literalPaths: true,
    tracking: ['usp', 'pli', 'authuser', 'ouid', 'rtpof', 'sd'],
    // /edit, /view, /preview and published (/d/e/<id>/pub) forms of one document.
    similar: (p) => ({
      ...p,
      path: p.path.replace(
        /^(\/(?:document|spreadsheets|presentation|forms|file)\/d\/(?:e\/)?[A-Za-z0-9_-]{10,})\/.*$/,
        '$1',
      ),
    }),
  },
  // Other code hosts
  {
    hosts:
      /^(?:gitlab\.com|codeberg\.org|bitbucket\.org|sr\.ht|git\.sr\.ht|huggingface\.co|gist\.github\.com)$/,
    literalPaths: true,
  },
];

export function ruleFor(host: string): SiteRule | undefined {
  return SITE_RULES.find((rule) => rule.hosts.test(host));
}
