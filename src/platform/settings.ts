// User settings (sync storage, one key per setting) and local UI preferences (WXT storage items).

import { browser, storage, type Browser } from '#imports';
import type { RedditHost } from '@/core/links';
import { DEFAULT_BLOCK_LIST, type SiteFilter } from '@/core/site-filter';
import { SOURCE_IDS, type SourceId } from '@/core/types';

export interface Settings {
  autoCheck: boolean;
  siteFilter: SiteFilter;
  sources: { hn: boolean; reddit: boolean };
  badge: 'discussions' | 'comments';
  redditHost: RedditHost;
  openInBackground: boolean;
  /** The number set large on the right of each popup row; the other one moves to the meta line. */
  rowStat: RowStat;
  /**
   * Text posts (posts that link to the page in their text or title) are listed with the discussions
   * and counted on the badge, so automatic lookups search for them too. Set with the popup's "Text
   * posts" toggle.
   */
  textPosts: boolean;
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
  textPosts: true,
});

/** What sync storage holds: written by any version, so any field (or nested field) may be missing. */
export type StoredSettings = { [K in keyof Settings]?: Partial<Settings[K]> };

/**
 * Each setting has its own key in sync storage ("settings.autoCheck", ...), and a save writes only
 * the settings it changes, so two pages changing different settings at once never undo each other.
 */
const FIELDS = Object.keys(DEFAULT_SETTINGS).filter(
  (key): key is keyof Settings => key in DEFAULT_SETTINGS,
);

export function settingKey(field: keyof Settings): string {
  return `settings.${field}`;
}

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

/**
 * Whether the popup's group of threads found through comments that link to the page ("Mentioned in
 * comments") starts open: as the user last left it; null until they first open or close it.
 */
export const mentionsOpenItem = storage.defineItem<boolean>('local:ui.mentionsOpen');

/**
 * The version whose notes ("What's new" in settings) the user has seen: set on install and when the
 * settings page opens. After an update it differs from the running version, and the popup's
 * settings button carries a dot.
 */
export const seenVersionItem = storage.defineItem<string>('local:ui.seenVersion');

/** The order of the sources in the popup (its tabs, status lines and buttons); set by dragging a tab. */
export const sourceOrderItem = storage.defineItem<SourceId[]>('local:ui.sourceOrder', {
  fallback: [...SOURCE_IDS],
});

/**
 * `order` with each source exactly once. It takes any value: storage does not check what it holds,
 * so a stale or malformed one (not an array, unknown ids, repeats) falls back to the default order.
 */
export function normalizeOrder(order: unknown): SourceId[] {
  const known: SourceId[] = [];
  for (const id of Array.isArray(order) ? order : []) {
    const source = SOURCE_IDS.find((s) => s === id);
    if (source !== undefined && !known.includes(source)) known.push(source);
  }
  return [...known, ...SOURCE_IDS.filter((id) => !known.includes(id))];
}

/**
 * Removes what 1.x left behind: its result cache in local storage (keyed by the URLs it looked up,
 * and on disk) and its options in sync storage. Every local key except this version's own goes.
 */
export async function removeV1Leftovers(): Promise<void> {
  const keep = new Set(
    [
      onboardedItem.key,
      sortItem.key,
      mentionsOpenItem.key,
      seenVersionItem.key,
      sourceOrderItem.key,
    ].map((key) => key.replace(/^local:/, '')),
  );
  const stale = Object.keys(await browser.storage.local.get(null)).filter((key) => !keep.has(key));
  await browser.storage.local.remove(stale);
  await browser.storage.sync.remove('options');
}

export async function getSettings(): Promise<Settings> {
  return withDefaults(fromStorage(await browser.storage.sync.get(FIELDS.map(settingKey))));
}

/**
 * Writes the settings in `next` that differ from `previous`, and only those. Nothing is read first,
 * so a write started as a page closes still lands.
 */
export async function saveSettings(next: Settings, previous: Settings): Promise<void> {
  const changed: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (JSON.stringify(next[field]) !== JSON.stringify(previous[field])) {
      changed[settingKey(field)] = next[field];
    }
  }
  if (Object.keys(changed).length > 0) await browser.storage.sync.set(changed);
}

/** Calls `cb` with the new and previous settings whenever they change (on any device). */
export function watchSettings(cb: (next: Settings, previous: Settings) => void): () => void {
  const listener = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
    if (area !== 'sync') return;
    const older: Record<string, unknown> = {};
    let changed = false;
    for (const field of FIELDS) {
      const change = changes[settingKey(field)];
      if (change === undefined) continue;
      changed = true;
      older[settingKey(field)] = change.oldValue;
    }
    if (!changed) return;
    getSettings().then(
      (next) => {
        // The previous settings: the current ones, with the old value of each changed setting.
        const previous: StoredSettings = { ...next };
        for (const field of FIELDS) {
          if (!(settingKey(field) in older)) continue;
          const value = older[settingKey(field)];
          if (value === undefined) delete previous[field];
          else Object.assign(previous, { [field]: value });
        }
        cb(next, withDefaults(previous));
      },
      (error: unknown) => console.error('Find On: reading settings failed', error),
    );
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** The stored settings among sync storage items, by field. */
function fromStorage(items: Record<string, unknown>): StoredSettings {
  const stored: Record<string, unknown> = {};
  for (const field of FIELDS) {
    const value = items[settingKey(field)];
    if (value !== undefined) stored[field] = value;
  }
  return stored;
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
