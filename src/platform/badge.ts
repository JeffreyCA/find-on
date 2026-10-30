// Per-tab toolbar badge. Failures never show a badge; the popup explains them.

import { browser } from '#imports';
import { BADGE_BACKGROUND, BADGE_TEXT, badgeText } from '@/core/format';
import { lookupKey } from '@/core/lookup';
import type { LookupResult } from '@/core/types';
import { readResult } from './cache';
import type { Settings } from './settings';

/** The settings the badge text depends on. */
export type BadgeSettings = Pick<Settings, 'badge' | 'textPosts'>;

/** Sets the badge text for one tab; '' removes it. Ignores tabs that no longer exist. */
export async function setBadge(tabId: number, text: string): Promise<void> {
  try {
    if (text !== '') {
      // Per tab, so the style survives the extension being disabled and re-enabled (neither
      // onInstalled nor onStartup fires then) and needs no global setup.
      await Promise.all([
        browser.action.setBadgeBackgroundColor({ tabId, color: BADGE_BACKGROUND }),
        browser.action.setBadgeTextColor({ tabId, color: BADGE_TEXT }),
      ]);
    }
    await browser.action.setBadgeText({ tabId, text });
  } catch {
    // The tab was closed in the meantime.
  }
}

export function clearBadge(tabId: number): Promise<void> {
  return setBadge(tabId, '');
}

/** Shows `result` on the tab, unless the tab has navigated away from the page `key` belongs to. */
export async function showResult(
  tabId: number,
  key: string,
  result: LookupResult,
  settings: BadgeSettings,
): Promise<void> {
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  if (tab?.url === undefined || lookupKey(tab.url) !== key) return;
  await setBadge(tabId, badgeText(result, settings.badge, settings.textPosts));
}

export async function clearAllBadges(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.flatMap(({ id }) => (id === undefined ? [] : [clearBadge(id)])));
}

/** Re-renders the badges currently shown from cached results (the badge mode or text posts changed). */
export async function refreshBadges(settings: BadgeSettings): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map(async ({ id: tabId, url }) => {
      if (tabId === undefined || url === undefined) return;
      const shown = await browser.action.getBadgeText({ tabId }).catch(() => '');
      if (shown === '') return;
      const key = lookupKey(url);
      const result = key === null ? undefined : await readResult(key);
      const text =
        result === undefined ? '' : badgeText(result, settings.badge, settings.textPosts);
      await setBadge(tabId, text);
    }),
  );
}
