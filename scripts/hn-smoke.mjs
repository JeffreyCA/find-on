// Live smoke test of the Hacker News lookup: runs the real lookup() (HN only, depth "full") against
// hn.algolia.com for a set of well-known URLs and prints the matches per tier. Exits with 1 when a
// URL that is known to have HN discussions finds no SAME/EXACT match, so it can serve as a canary
// for changes in the (undocumented) Algolia proxy.
//
// Usage: node scripts/hn-smoke.mjs [url ...]

import path from 'node:path';
import { createServer } from 'vite';

/** `strong`: the URL is known to have at least one SAME/EXACT submission on HN. */
const CASES = [
  { url: 'https://xkcd.com/927/', strong: true },
  { url: 'http://www.paulgraham.com/greatwork.html?utm_source=x', strong: true },
  { url: 'https://youtu.be/dQw4w9WgXcQ?si=abc', strong: true },
  { url: 'https://arxiv.org/pdf/1706.03762v7', strong: true },
  { url: 'https://en.m.wikipedia.org/wiki/Hacker_News', strong: true },
  { url: 'https://github.com/torvalds/linux', strong: true },
  { url: 'https://www.youtube.com/watch?v=-BP7DhHTU-I', strong: true },
  { url: 'https://news.ycombinator.com/item?id=36550615', strong: true },
  { url: 'https://example.com/', strong: true },
  { url: 'https://news.ycombinator.com/item?id=121003', strong: true },
  { url: 'https://example.org/this/page/was/never/submitted-anywhere', strong: false },
];

const root = path.resolve(import.meta.dirname, '..');
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  resolve: { alias: { '@': path.join(root, 'src') } },
});

let failed = 0;
try {
  const { lookup } = await server.ssrLoadModule('/src/core/lookup.ts');
  const kvStore = new Map();
  const env = {
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    kv: {
      get: async (key) => kvStore.get(key),
      set: async (key, value) => void kvStore.set(key, value),
    },
  };
  const urls = process.argv.slice(2);
  const cases = urls.length > 0 ? urls.map((url) => ({ url, strong: false })) : CASES;

  for (const { url, strong } of cases) {
    const started = Date.now();
    // oxlint-disable-next-line no-await-in-loop -- one URL at a time, to be gentle with the API
    const result = await lookup(
      url,
      {
        depth: 'full',
        sources: { hn: true, reddit: false },
        incognito: false,
        signal: AbortSignal.timeout(30_000),
      },
      env,
    );
    const ms = Date.now() - started;
    const hn = result.sources.hn;
    const page = result.page;
    const resolved = page.resolvedFrom
      ? ` (resolved from ${page.resolvedFrom.source}:${page.resolvedFrom.id})`
      : '';
    const noLink = page.noLink ? ` (text post ${page.noLink.source}:${page.noLink.id})` : '';
    console.log(`\n${url}\n  page: ${page.display}${resolved}${noLink}  [${ms} ms]`);
    if (hn.status !== 'ok') {
      console.log(`  hn: ${hn.status}${'detail' in hn ? ` (${hn.detail})` : ''}`);
      if (strong) failed++;
      continue;
    }
    const byTier = { same: [], exact: [], similar: [] };
    for (const d of hn.items) byTier[d.tier].push(d);
    console.log(
      `  same ${byTier.same.length}, exact ${byTier.exact.length}, similar ${byTier.similar.length}${hn.complete ? '' : ', incomplete'}`,
    );
    for (const tier of ['same', 'exact', 'similar']) {
      for (const d of byTier[tier].slice(0, 3)) {
        console.log(
          `    ${tier.padEnd(7)} ${String(d.comments).padStart(5)}c  ${d.id}  ${d.submittedUrl}`,
        );
      }
    }
    if (strong && byTier.same.length + byTier.exact.length === 0) {
      console.log('  FAIL: expected a SAME/EXACT match');
      failed++;
    }
  }
} finally {
  await server.close();
}
console.log(failed > 0 ? `\n${failed} case(s) failed` : '\nall cases passed');
process.exitCode = failed > 0 ? 1 : 0;
