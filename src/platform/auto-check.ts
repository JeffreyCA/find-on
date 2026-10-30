// Automatic checks: look up the page in the active tab when it finishes loading or is
// activated, and show the count on the toolbar badge.
//
// Nothing here has to survive a service worker restart. Every activation runs a cache-first check, so
// a tab that loaded in the background (or before the worker started) is checked when the user
// switches to it, and a tab with a fresh cached result costs no request. The debounce timers and
// abort controllers below only live for the duration of a check.

import { browser, type Browser } from '#imports';
import { isAllowedByFilter } from '@/core/site-filter';
import { checkEligibility, computeKeys } from '@/core/url';
import { clearBadge, showResult } from './badge';
import { runLookup } from './lookup-service';
import { getSettings, onboardedItem, type Settings } from './settings';

/** Coalesces SPA URL changes (pushState, replaceState, hash) and redirects right after load. */
export const DEBOUNCE_MS = 500;

export type SkipReason =
  | 'auto-off'
  | 'not-onboarded'
  | 'no-sources'
  | 'incognito'
  | 'not-loaded'
  | 'ineligible'
  | 'filtered';

export type Decision = { check: true; url: string } | { check: false; reason: SkipReason };

type TabInfo = Pick<Browser.tabs.Tab, 'url' | 'status' | 'incognito'>;

/**
 * Whether a tab should be checked automatically. `url` is the tab's URL as is: runLookup sanitizes it
 * and keys the cache on it, the same way the popup and the badge code do.
 */
export function decide(tab: TabInfo, settings: Settings, onboarded: boolean): Decision {
  if (!settings.autoCheck) return { check: false, reason: 'auto-off' };
  if (!onboarded) return { check: false, reason: 'not-onboarded' };
  if (!settings.sources.hn && !settings.sources.reddit)
    return { check: false, reason: 'no-sources' };
  // Incognito tabs are skipped entirely, before their URL is even parsed.
  if (tab.incognito) return { check: false, reason: 'incognito' };
  if (tab.status !== 'complete' || tab.url === undefined) {
    return { check: false, reason: 'not-loaded' };
  }
  const eligibility = checkEligibility(tab.url);
  if (!eligibility.ok) return { check: false, reason: 'ineligible' };
  // The page and, for a wrapper (an archive copy, a redirect shim), the page it wraps, which is what
  // the lookup sends.
  const target = computeKeys(eligibility.url)?.cleaned ?? eligibility.url;
  if (![eligibility.url, target].every((url) => isAllowedByFilter(url, settings.siteFilter))) {
    return { check: false, reason: 'filtered' };
  }
  return { check: true, url: tab.url };
}

const timers = new Map<number, ReturnType<typeof setTimeout>>();
const running = new Map<number, AbortController>();

/** Registers the tab listeners. Call synchronously at service worker start. */
export function registerAutoCheck(): void {
  browser.tabs.onUpdated.addListener(onTabUpdated);
  browser.tabs.onActivated.addListener(onTabActivated);
  browser.tabs.onRemoved.addListener(cancel);
}

function onTabUpdated(tabId: number, changeInfo: Browser.tabs.OnUpdatedInfo): void {
  // Chromium reports full loads and same-document navigations alike as `loading` (with `url` when it
  // changed) followed by `complete`. Per-tab badges survive same-document navigations, so clear
  // them here; the old page's count would be wrong for the new URL.
  if (changeInfo.status === 'loading' || changeInfo.url !== undefined) {
    cancel(tabId);
    void clearBadge(tabId);
  }
  if (changeInfo.status === 'complete' || changeInfo.url !== undefined) schedule(tabId);
}

function onTabActivated({ tabId }: Browser.tabs.OnActivatedInfo): void {
  // A pending debounce will check it shortly.
  if (!timers.has(tabId)) void checkTab(tabId);
}

function schedule(tabId: number): void {
  clearTimeout(timers.get(tabId));
  timers.set(
    tabId,
    setTimeout(() => {
      timers.delete(tabId);
      void checkTab(tabId);
    }, DEBOUNCE_MS),
  );
}

/** Drops a tab's pending debounce and aborts its running check (navigation, close). */
export function cancel(tabId: number): void {
  clearTimeout(timers.get(tabId));
  timers.delete(tabId);
  running.get(tabId)?.abort();
  running.delete(tabId);
}

/** Cancels every scheduled and running automatic check (e.g. automatic checks were turned off). */
export function cancelAll(): void {
  for (const tabId of [...timers.keys(), ...running.keys()]) cancel(tabId);
}

/**
 * Checks one tab if it is active in its window and passes the skip rules. Inactive tabs are left
 * for `tabs.onActivated`. Never rejects.
 */
export async function checkTab(tabId: number): Promise<void> {
  // One check per tab at a time; navigation cancels it, so a running check is for the current URL.
  if (running.has(tabId)) return;
  const controller = new AbortController();
  running.set(tabId, controller);
  try {
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    if (tab === undefined || !tab.active) return;
    const [settings, onboarded] = await Promise.all([getSettings(), onboardedItem.getValue()]);
    const decision = decide(tab, settings, onboarded);
    if (!decision.check || controller.signal.aborted) return;

    const { siteFilter } = settings;
    const { key, result } = await runLookup(decision.url, {
      depth: 'auto',
      incognito: false,
      signal: controller.signal,
      // The page a thread links to is checked against the blocklist too. In allowlist mode the
      // thread page itself was allowed, which is enough.
      ...(siteFilter.mode === 'block' && {
        isBlocked: (url: string) => !isAllowedByFilter(url, siteFilter),
      }),
    });
    if (!controller.signal.aborted) await showResult(tabId, key, result, settings);
  } catch (error) {
    if (!controller.signal.aborted) console.warn('Find On: automatic check failed', error);
  } finally {
    if (running.get(tabId) === controller) running.delete(tabId);
  }
}

/** Checks the active tab of the focused window (service worker start, install, startup). */
export async function checkFocusedTab(): Promise<void> {
  await checkActiveTabs({ lastFocusedWindow: true });
}

/** Checks the active tab of every window (or only of the last focused one). */
export async function checkActiveTabs(where: { lastFocusedWindow?: true } = {}): Promise<void> {
  const tabs = await browser.tabs.query({ active: true, ...where }).catch(() => []);
  await Promise.all(tabs.flatMap(({ id }) => (id === undefined ? [] : [checkTab(id)])));
}
