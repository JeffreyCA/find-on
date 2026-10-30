// Store screenshots (1280x800, 24-bit PNG): the real popup from the built extension, answered with
// recorded responses, under a browser bar over a placeholder page. The scene is laid out at 1024x640
// and captured at 1.25x, so the popup reads larger than life and the page takes less of the frame.
// Writes store/screenshots/1-results.png, 2-results-dark.png and 3-thread.png.
//
// Discussions come from the test fixtures. HN mention searches are replayed from store/recorded/;
// `--record` fetches them from hn.algolia.com again. Reddit mention searches need a signed-in
// session to record, so they answer with nothing.
//
// Usage: npm run screenshots [-- --record]

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const EXTENSION = path.join(root, '.output/chrome-mv3');
const FIXTURES = path.join(root, 'src/core/providers/__fixtures__');
const RECORDED = path.join(root, 'store/recorded');
const OUT = path.join(root, 'store/screenshots');
const RECORD = process.argv.includes('--record');

// The scene in CSS pixels, captured at SCALE.
const WIDTH = 1024;
const HEIGHT = 640;
const SCALE = 1.25;
const BAR = 44;
const POPUP_TOP = BAR + 4;
const POPUP_MAX = HEIGHT - POPUP_TOP - 12;

const EMPTY_LISTING = { kind: 'Listing', data: { after: null, children: [] } };
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const icon = `data:image/png;base64,${fs.readFileSync(path.join(EXTENSION, 'icons/32.png')).toString('base64')}`;

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  viewport: { width: WIDTH, height: HEIGHT },
  args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const extensionId = new URL(worker.url()).host;

/** Recordings a scene asked for but store/recorded/ lacks; checked after each popup. */
const missing = new Set();

/**
 * An HN mention search for the scene `slug`: replayed from RECORDED, or fetched with --record. Null
 * when there is no recording.
 */
async function recordedMentions(route, slug) {
  const hits = new URL(route.request().url()).searchParams.get('hitsPerPage');
  const file = path.join(RECORDED, `hn-mentions-${slug}-${hits}.json`);
  if (RECORD) {
    const response = await route.fetch();
    fs.mkdirSync(RECORDED, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(await response.json(), null, 2)}\n`);
  }
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  missing.add(path.relative(root, file));
  return null;
}

function json(route, body) {
  return route.fulfill({
    contentType: 'application/json; charset=UTF-8',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Answers HN and Reddit for one scene and aborts every other request. */
async function mockNetwork({ slug, hnSearch, hnItem, redditSearch, redditInfo }) {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  // The last matching route wins, so the catch-all comes first.
  await context.route(
    (url) => url.protocol === 'http:' || url.protocol === 'https:',
    (route) => route.abort(),
  );
  await context.route(
    (url) => url.origin === 'https://hn.algolia.com',
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/search_by_date') {
        const body = await recordedMentions(route, slug);
        return body === null ? route.abort() : json(route, body);
      }
      const tags = url.searchParams.get('tags') ?? '';
      if (hnItem && tags.includes(`story_${hnItem.objectID}`)) {
        return json(route, { hits: [hnItem], nbHits: 1 });
      }
      return json(route, hnSearch);
    },
  );
  await context.route(
    (url) => url.origin === 'https://old.reddit.com',
    (route) => {
      const { pathname, searchParams } = new URL(route.request().url());
      if (pathname === '/search.json' && searchParams.get('q')?.startsWith('"') === true) {
        return json(route, EMPTY_LISTING);
      }
      if (pathname === '/search.json') return json(route, redditSearch ?? EMPTY_LISTING);
      if (pathname === '/api/info.json') return json(route, redditInfo ?? EMPTY_LISTING);
      return json(route, [EMPTY_LISTING, EMPTY_LISTING]);
    },
  );
}

/** Starts from fresh storage with `settings` stored over the defaults. */
async function resetStorage(settings) {
  await worker.evaluate(async (stored) => {
    const { storage, runtime } = globalThis.chrome;
    await Promise.all([storage.session.clear(), storage.local.clear(), storage.sync.clear()]);
    await storage.local.set({ onboarded: true, 'ui.seenVersion': runtime.getManifest().version });
    await storage.sync.set(
      Object.fromEntries(Object.entries(stored).map(([field, v]) => [`settings.${field}`, v])),
    );
  }, settings);
}

/** A PNG of `clip` (CSS pixels) at SCALE. */
async function capture(page, clip) {
  const cdp = await context.newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { ...clip, scale: SCALE },
  });
  await cdp.detach();
  return Buffer.from(data, 'base64');
}

/** The popup for `url` as an image, its height in CSS pixels, and the badge it would set. */
async function popupShot({ url, scheme, settings = {} }) {
  await resetStorage(settings);
  const page = await context.newPage();
  await page.setViewportSize({ width: 400, height: 600 });
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(`chrome-extension://${extensionId}/popup.html?url=${encodeURIComponent(url)}`);
  await page.locator('.row:not(.is-skeleton)').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('.is-skeleton, .pending-dots'));
  await sleep(600);
  const natural = Math.ceil((await page.locator('.popup').boundingBox()).height);
  const height = Math.min(natural, POPUP_MAX);
  // Taller than the scene allows: the list scrolls inside the popup, as it does past 600 px.
  if (natural > height) await page.addStyleTag({ content: `.popup { max-height: ${height}px; }` });
  await page.mouse.move(399, 599);
  await sleep(300);
  // The badge counts what "All" counts, except the thread the page is.
  const all = await page.locator('.segment', { hasText: 'All' }).first().textContent();
  const onThread = (await page.locator('.tag-current').count()) > 0;
  const badge = String(Number(all.replace(/\D+/g, '')) - (onThread ? 1 : 0));
  const image = await capture(page, { x: 0, y: 0, width: 400, height });
  await page.close();
  if (missing.size > 0) throw new Error(`Missing ${[...missing].join(', ')}: run with --record`);
  return { src: `data:image/png;base64,${image.toString('base64')}`, height, badge };
}

const THEMES = {
  light: {
    bar: '#eef0f2',
    line: '#dadde1',
    field: '#ffffff',
    fieldText: '#3c4043',
    page: '#ffffff',
    placeholder: '#eceef1',
    art: '#f3f4f6',
    title: '#2a2d31',
    button: '#dfe3e7',
    shadow: '0 12px 36px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.08)',
  },
  dark: {
    bar: '#2b2d31',
    line: '#3b3e43',
    field: '#1d1e21',
    fieldText: '#c2c6cb',
    page: '#202124',
    placeholder: '#2c2e32',
    art: '#27292d',
    title: '#d6d9dd',
    button: '#3a3d42',
    shadow: '0 12px 36px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1)',
  },
};

/** Writes `file`: the popup under a browser bar (address, the extension's button and badge). */
async function compose(file, { scheme, popup, address, title }) {
  const t = THEMES[scheme];
  const page = await context.newPage();
  const lines = [94, 86, 91, 64, 89, 78, 93, 58]
    .map((width) => `<div class="line" style="width: ${width}%"></div>`)
    .join('');
  await page.setContent(`<!doctype html><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: ${t.page};
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .bar { height: ${BAR}px; display: flex; align-items: center; gap: 12px; padding: 0 10px 0 16px;
    background: ${t.bar}; border-bottom: 1px solid ${t.line}; }
  .dots { display: flex; gap: 7px; }
  .dots i { width: 11px; height: 11px; border-radius: 50%; background: ${t.line}; }
  .address { flex: 1; height: 30px; display: flex; align-items: center; padding: 0 14px;
    border-radius: 15px; background: ${t.field}; color: ${t.fieldText}; font-size: 13px; }
  .button { position: relative; width: 30px; height: 30px; display: grid; place-items: center;
    border-radius: 6px; background: ${t.button}; }
  .button img { width: 16px; height: 16px; display: block; }
  .badge { position: absolute; right: 1px; bottom: 2px; height: 11px; min-width: 11px; padding: 0 2px;
    border-radius: 2px; background: #1f2124; color: #fff; text-align: center;
    font: 700 9px/11px system-ui, -apple-system, sans-serif; }
  main { width: 420px; margin: 44px 0 0 56px; }
  h1 { margin: 0 0 22px; color: ${t.title}; font: 600 26px/1.2 system-ui, -apple-system, sans-serif; }
  .art { height: 150px; margin: 0 0 24px; border-radius: 6px; background: ${t.art}; }
  .line { height: 11px; margin: 0 0 14px; border-radius: 3px; background: ${t.placeholder}; }
  .popup { position: absolute; top: ${POPUP_TOP}px; right: 10px; width: 400px; height: ${popup.height}px;
    overflow: hidden; border-radius: 8px; box-shadow: ${t.shadow}; }
  .popup img { display: block; width: 400px; height: ${popup.height}px; }
  </style>
  <div class="bar">
    <div class="dots"><i></i><i></i><i></i></div>
    <div class="address">${address}</div>
    <div class="button"><img src="${icon}"><span class="badge">${popup.badge}</span></div>
  </div>
  <main>${title ? `<h1>${title}</h1><div class="art"></div>` : ''}${lines}</main>
  <div class="popup"><img src="${popup.src}"></div>`);
  await page.locator('.popup img').evaluate((img) => img.decode());
  const image = await capture(page, { x: 0, y: 0, width: WIDTH, height: HEIGHT });
  fs.writeFileSync(path.join(OUT, file), image);
  await page.close();
  console.log(`store/screenshots/${file}`);
}

try {
  const xkcd = 'https://xkcd.com/927/';
  await mockNetwork({
    slug: 'xkcd-927',
    hnSearch: fixture('hn-search-xkcd-927.json'),
    redditSearch: fixture('reddit-search-xkcd-927.json'),
    redditInfo: fixture('reddit-info-xkcd-927.json'),
  });
  await compose('1-results.png', {
    scheme: 'light',
    popup: await popupShot({ url: xkcd, scheme: 'light' }),
    address: 'xkcd.com/927/',
    title: 'Standards',
  });
  await compose('2-results-dark.png', {
    scheme: 'dark',
    popup: await popupShot({ url: xkcd, scheme: 'dark', settings: { rowStat: 'comments' } }),
    address: 'xkcd.com/927/',
    title: 'Standards',
  });

  // On the HN thread of paulgraham.com/greatwork.html, which the popup looks up instead.
  const greatwork = fixture('hn-search-paulgraham-greatwork.json');
  await mockNetwork({
    slug: 'greatwork',
    hnSearch: greatwork,
    hnItem: greatwork.hits.find((hit) => hit.objectID === '36550615'),
  });
  await compose('3-thread.png', {
    scheme: 'light',
    popup: await popupShot({
      url: 'https://news.ycombinator.com/item?id=36550615',
      scheme: 'light',
    }),
    address: 'news.ycombinator.com/item?id=36550615',
  });
} finally {
  await context.close();
}
