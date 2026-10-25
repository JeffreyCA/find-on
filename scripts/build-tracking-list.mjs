#!/usr/bin/env node
// Generates src/core/url/tracking-params.generated.json: the query parameters that only track and
// never identify a page. Sources are MPL-2.0 lists only, plus a short curated list of well-known
// click ids (names are facts, no list text is copied):
//   - Brave adblock-lists: brave-lists/clean-urls.json and brave-lists/query-filter.json
//   - Firefox: toolkit/components/antitracking/StripOnShareLists/MPL2/StripOnShare.json
// The output is covered by the MPL-2.0 (see src/core/url/MPL-2.0.txt). Never fetched at runtime.
//
// Usage:
//   node scripts/build-tracking-list.mjs              fetch the upstream lists
//   node scripts/build-tracking-list.mjs --from DIR   read local copies named clean-urls.json,
//                                                     query-filter.json and StripOnShare.json
//   --out FILE                                        write somewhere else
//
// Output shape (consumed by src/core/url/tracking.ts):
//   prefixes: name prefixes that are tracking everywhere ("utm_")
//   global:   lowercased names that are tracking everywhere
//   sites:    [{ hosts, params }] where a host is "example.com" (that host, with or without "www."),
//             "*.example.com" (the domain and all subdomains), optionally followed by a path glob
//             matched against path + query ("www.google.com/search?*")
//
// Upstream exclusions ("exclude" patterns) are not carried over: they all protect redirect wrappers
// (urldefense.com, twitter.com/i/redirect, app.hive.co) whose parameters Find On never sends.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCES = {
  braveCleanUrls: {
    file: 'clean-urls.json',
    url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/clean-urls.json',
    page: 'https://github.com/brave/adblock-lists/blob/master/brave-lists/clean-urls.json',
  },
  braveQueryFilter: {
    file: 'query-filter.json',
    url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/query-filter.json',
    page: 'https://github.com/brave/adblock-lists/blob/master/brave-lists/query-filter.json',
  },
  firefoxStripOnShare: {
    file: 'StripOnShare.json',
    url: 'https://raw.githubusercontent.com/mozilla-firefox/firefox/main/toolkit/components/antitracking/StripOnShareLists/MPL2/StripOnShare.json',
    page: 'https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/antitracking/StripOnShareLists/MPL2/StripOnShare.json',
  },
};

// Click and newsletter ids missing from some MPL lists. Each one is tracking-only in at least one
// of the ClearURLs, AdGuard or uBlock Origin lists.
const CURATED_GLOBAL = [
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_eid',
  'mc_cid',
  'mkt_tok',
  'igshid',
  'igsh',
  '_ga',
  '_gl',
  '__twitter_impression',
  'twclid',
  'ttclid',
  'li_fat_id',
  'rb_clickid',
  's_cid',
  'vero_id',
  'vero_conv',
  'oly_anon_id',
  'oly_enc_id',
  'wickedid',
  'yclid',
  'ysclid',
  '_hsenc',
  '_hsmi',
  '__hssc',
  '__hstc',
  '__hsfp',
  'hsctatracking',
  'ncid',
  'sr_share',
  'spm',
  'srsltid',
  'gad_source',
  'gad_campaignid',
  '_bhlid',
  'ck_subscriber_id',
  'cmpid',
];

// Names that are only tracking everywhere.
const PREFIXES = ['utm_'];

// Names some lists strip globally but that identify content on enough sites to cause false EXACT
// matches (e.g. Firefox reverted `lid` in bug 2068611; `adid` is a listing id on classifieds sites).
// Site rules and the SIMILAR tier handle them instead.
const NOT_GLOBAL = new Set([
  'var',
  'lid',
  'ref',
  'source',
  'src',
  'from',
  'si',
  's',
  't',
  'mc',
  'campaign',
  'clickid',
  'adid',
]);

// Test fixtures in the Brave list, not real sites.
const IGNORED_HOSTS = new Set(['dev-pages.bravesoftware.com']);

const LICENSE_NOTICE =
  'This file is generated from MPL-2.0 data and is subject to the terms of the Mozilla Public ' +
  'License, v. 2.0. If a copy of the MPL was not distributed with this file, you can obtain one ' +
  'at https://mozilla.org/MPL/2.0/ (a copy is in MPL-2.0.txt next to this file).';

function parseArgs(argv) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = {
    from: null,
    out: path.join(repoRoot, 'src/core/url/tracking-params.generated.json'),
  };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === '--from' && value) args.from = path.resolve(argv[++i]);
    else if (argv[i] === '--out' && value) args.out = path.resolve(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  return args;
}

async function load(source, fromDir) {
  if (fromDir) return JSON.parse(fs.readFileSync(path.join(fromDir, source.file), 'utf8'));
  const res = await fetch(source.url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GET ${source.url}: HTTP ${res.status}`);
  return res.json();
}

/** Lowercased, percent-decoded parameter name ("%24deep_link" -> "$deep_link"). */
function normalizeName(name) {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // Keep the raw name.
  }
  return decoded.toLowerCase();
}

/**
 * Chrome match pattern ("*://*.example.com/path*") to the compact host form described above, or
 * null for patterns that apply to every host.
 */
function toHostPattern(pattern) {
  const m = /^(?:\*|https?):\/\/([^/]+)(\/.*)?$/.exec(pattern);
  if (!m) throw new Error(`Unexpected match pattern: ${pattern}`);
  const [, host, urlPath = '/*'] = m;
  if (host === '*') return null;
  return urlPath === '/*' ? host : host + urlPath;
}

async function main({ from, out }) {
  const [cleanUrls, queryFilter, stripOnShare] = await Promise.all([
    load(SOURCES.braveCleanUrls, from),
    load(SOURCES.braveQueryFilter, from),
    load(SOURCES.firefoxStripOnShare, from),
  ]);

  const global = new Set(CURATED_GLOBAL.map(normalizeName));
  const sites = [];
  const addRule = (patterns, params) => {
    const hosts = patterns.map(toHostPattern);
    const names = [...new Set(params.map(normalizeName))];
    if (hosts.includes(null)) {
      for (const n of names) global.add(n);
      return;
    }
    const kept = hosts.filter((h) => !IGNORED_HOSTS.has(h.replace(/^\*\./, '').split('/')[0]));
    if (kept.length > 0) sites.push({ hosts: kept, params: names });
  };

  for (const rule of [...cleanUrls, ...queryFilter]) addRule(rule.include, rule.params);
  for (const entry of Object.values(stripOnShare)) {
    if (entry.isGlobal) {
      for (const n of entry.queryParams) global.add(normalizeName(n));
      continue;
    }
    const patterns = [
      ...(entry.hosts ?? []).map((h) => `*://${h}/*`),
      ...(entry.schemelessSites ?? []).map((h) => `*://*.${h}/*`),
    ];
    addRule(patterns, entry.queryParams);
  }

  const covered = (n) => PREFIXES.some((p) => n.startsWith(p));
  const globalList = [...global]
    .filter((n) => !covered(n) && !NOT_GLOBAL.has(n))
    .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const site of sites) site.params = site.params.filter((n) => !covered(n) && !global.has(n));
  const siteList = sites.filter((s) => s.params.length > 0);

  const output = {
    license: LICENSE_NOTICE,
    generator: 'scripts/build-tracking-list.mjs (npm run update-tracking-list)',
    sources: [...Object.values(SOURCES).map((s) => s.page), 'curated list in the generator'],
    prefixes: PREFIXES,
    global: globalList,
    sites: siteList,
  };
  fs.writeFileSync(out, JSON.stringify(output, null, 2) + '\n');
  const siteParams = siteList.reduce((n, s) => n + s.params.length, 0);
  console.log(
    `Wrote ${path.relative(process.cwd(), out)}: ${globalList.length} global names, ` +
      `${siteList.length} site rules (${siteParams} names), ${fs.statSync(out).size} bytes`,
  );
}

main(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
