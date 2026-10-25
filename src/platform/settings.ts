// User settings and local UI preferences, stored through WXT's storage wrapper.

import { storage } from '#imports';
import type { RedditHost } from '@/core/links';
import { DEFAULT_BLOCK_LIST, type SiteFilter } from '@/core/site-filter';

export interface Settings {
  autoCheck: boolean;
  siteFilter: SiteFilter;
  sources: { hn: boolean; reddit: boolean };
  badge: 'discussions' | 'comments';
  redditHost: RedditHost;
  openInBackground: boolean;
  /** The number set large on the right of each popup row; the other one moves to the meta line. */
  rowStat: RowStat;
}

export type RowStat = 'comments' | 'points';
export type SortOrder = 'comments' | 'points' | 'newest';

/**
 * Frozen because settings read from storage share these objects wherever nothing overrides them.
 * Copy before editing.
 */
export const DEFAULT_SETTINGS: Settings = deepFreeze({
  autoCheck: true,
  siteFilter: { mode: 'block', block: [...DEFAULT_BLOCK_LIST], allow: [] },
  sources: { hn: true, reddit: true },
  badge: 'discussions',
  redditHost: 'www',
  openInBackground: false,
  rowStat: 'points',
});

/** What sync storage holds: written by any version, so any field (or nested field) may be missing. */
export type StoredSettings = { [K in keyof Settings]?: Partial<Settings[K]> };

const settingsItem = storage.defineItem<StoredSettings>('sync:settings', { fallback: {} });

/**
 * Automatic checks run only once the user has made a choice: picked a mode in the popup or on the
 * welcome page, or changed anything on the options page.
 */
export const onboardedItem = storage.defineItem<boolean>('local:onboarded', {
  fallback: false,
});

/**
 * The popup's sort order once the user picks one there; null until then, when the list sorts by the
 * number set large on each row (`rowStat`), so that column reads from largest to smallest.
 */
export const sortItem = storage.defineItem<SortOrder>('local:ui.sort');

export async function getSettings(): Promise<Settings> {
  return withDefaults(await settingsItem.getValue());
}

export function saveSettings(settings: Settings): Promise<void> {
  return settingsItem.setValue(settings);
}

/** Calls `cb` with the new and previous settings whenever they change (on any device). */
export function watchSettings(cb: (next: Settings, previous: Settings) => void): () => void {
  return settingsItem.watch((next, previous) => cb(withDefaults(next), withDefaults(previous)));
}

/** The defaults, overridden by whatever is stored; nested objects are merged per key. */
function withDefaults(stored: StoredSettings): Settings {
  const d = DEFAULT_SETTINGS;
  return {
    ...d,
    ...stored,
    siteFilter: { ...d.siteFilter, ...stored.siteFilter },
    sources: { ...d.sources, ...stored.sources },
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
