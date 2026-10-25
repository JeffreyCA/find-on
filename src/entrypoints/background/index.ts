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
    incognito: await isIncognito(req.tabId, sender),
    force: req.force ?? false,
  });
  // The badge follows popup lookups too, for the tab they were made for.
  if (req.tabId !== undefined) {
    const { badge } = await getSettings();
    await showResult(req.tabId, key, result, badge);
  }
  return result;
}

/**
 * Whether a lookup request comes from a private window. The popup is not a tab, so without a tab id
 * the last focused window (the one the popup belongs to) decides. Errs on the private side.
 */
async function isIncognito(
  tabId: number | undefined,
  sender: Browser.runtime.MessageSender,
): Promise<boolean> {
  try {
    if (tabId !== undefined) return (await browser.tabs.get(tabId)).incognito;
    if (sender.tab !== undefined) return sender.tab.incognito;
    return (await browser.windows.getLastFocused()).incognito;
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
  if (next.badge !== previous.badge) await refreshBadges(next.badge);
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
  if (recheck) await checkActiveTabs();
}
