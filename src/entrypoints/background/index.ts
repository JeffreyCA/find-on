// Service worker wiring. Every listener is registered synchronously when the worker starts, so
// events that wake the worker are delivered (MV3 rule). The logic lives in src/platform.

import { browser, defineBackground, type Browser } from '#imports';
import { clearAllBadges, refreshBadges, showResult } from '@/platform/badge';
import {
  cancelAll,
  checkActiveTabs,
  checkFocusedTab,
  registerAutoCheck,
} from '@/platform/auto-check';
import { createMenus, registerContextMenu } from '@/platform/context-menu';
import { checkRedditSignIn, runLookup } from '@/platform/lookup-service';
import { onRequest, type Request } from '@/platform/messaging';
import {
  getSettings,
  onboardedItem,
  removeV1Leftovers,
  seenVersionItem,
  watchSettings,
  type Settings,
} from '@/platform/settings';

export default defineBackground(() => {
  onRequest(handleRequest);
  registerAutoCheck();
  registerContextMenu();

  browser.runtime.onInstalled.addListener((details) => {
    void onInstalled(details).catch((error: unknown) => {
      console.error('Find On: install/update handling failed', error);
    });
  });
  browser.runtime.onStartup.addListener(() => {
    void checkFocusedTab();
  });

  watchSettings((next, previous) => {
    void onSettingsChanged(next, previous).catch((error: unknown) => {
      console.error('Find On: applying settings failed', error);
    });
  });
  onboardedItem.watch((onboarded) => {
    if (onboarded) void checkActiveTabs();
  });
});

async function handleRequest(
  req: Request,
  sender: Browser.runtime.MessageSender,
): Promise<unknown> {
  if (req.type === 'reddit-check') {
    // Same rules as lookups: nothing goes to Reddit while it is off, or from a private window.
    const { sources } = await getSettings();
    if (!sources.reddit || (await isIncognito(undefined, sender))) return { signedIn: null };
    return { signedIn: await checkRedditSignIn() };
  }

  const { key, result } = await runLookup(req.url, {
    depth: req.depth,
    incognito: await isIncognito(req.tabId, sender, req.windowId),
    force: req.force ?? false,
  });
  // The badge follows popup lookups too, for the tab they were made for.
  if (req.tabId !== undefined) await showResult(req.tabId, key, result, await getSettings());
  return result;
}

/**
 * Whether a request comes from a private window: the tab it is about, else the sending tab, else the
 * window the popup (which is not a tab) says it belongs to. Never the focused window, which may have
 * changed by now. Errs on the private side when none of these is known.
 */
async function isIncognito(
  tabId: number | undefined,
  sender: Browser.runtime.MessageSender,
  windowId?: number,
): Promise<boolean> {
  try {
    if (tabId !== undefined) return (await browser.tabs.get(tabId)).incognito;
    if (sender.tab !== undefined) return sender.tab.incognito;
    if (windowId !== undefined) return (await browser.windows.get(windowId)).incognito;
    return true;
  } catch {
    return true;
  }
}

async function onInstalled({
  reason,
  previousVersion,
}: Browser.runtime.InstalledDetails): Promise<void> {
  await createMenus().catch((error: unknown) => {
    console.error('Find On: creating context menus failed', error);
  });
  // An update from 1.x leaves its storage behind and, like an install, starts with the welcome page,
  // where automatic lookups are turned on.
  const fromV1 = reason === 'update' && previousVersion.startsWith('1.');
  if (fromV1) {
    await removeV1Leftovers().catch((error: unknown) => {
      console.error('Find On: removing 1.x data failed', error);
    });
  }
  // A new install has nothing new to point out; an update leaves the old version, so the popup's
  // settings button points to what changed.
  if (reason === 'install') {
    await seenVersionItem
      .setValue(browser.runtime.getManifest().version)
      .catch((error: unknown) => {
        console.error('Find On: recording the version failed', error);
      });
  }
  if (reason === 'install' || fromV1) {
    await browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
    return;
  }
  // Other updates change nothing visible; just pick up the current tab again.
  await checkFocusedTab();
}

async function onSettingsChanged(next: Settings, previous: Settings): Promise<void> {
  if (!next.autoCheck && previous.autoCheck) {
    cancelAll();
    await clearAllBadges();
    return;
  }
  // Badges from manual checks are re-rendered too, so this runs whether or not auto-check is on.
  if (next.badge !== previous.badge || next.textPosts !== previous.textPosts) {
    await refreshBadges(next);
  }
  const sourcesChanged = JSON.stringify(next.sources) !== JSON.stringify(previous.sources);
  const filterChanged = JSON.stringify(next.siteFilter) !== JSON.stringify(previous.siteFilter);
  const recheck = next.autoCheck && (!previous.autoCheck || sourcesChanged || filterChanged);
  // Any badge, from a manual lookup too, may count a source that is now off; with automatic lookups
  // a tab may also be on a newly skipped site. Inactive tabs get theirs back (from the cache, or a
  // new check) when they are activated.
  if (recheck || sourcesChanged) {
    cancelAll();
    await clearAllBadges();
  }
  // Turned on, text posts are searched for on the pages in view (the cache may have them already).
  const textPostsOn = next.autoCheck && next.textPosts && !previous.textPosts;
  if (recheck || textPostsOn) await checkActiveTabs();
}
