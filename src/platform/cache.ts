// Session cache of lookup results, plus a KV adapter over storage.session for the core.
//
// Each result lives under `result:<key>` in storage.session. The same key holds the progressive
// snapshots the popup renders while a lookup runs, so the last write wins and is the cached answer.
// storage.session is in memory only, survives service worker restarts (but not an update), and is
// readable by extension pages (the default TRUSTED_CONTEXTS access level), so nothing here touches
// disk. Lookups made for a private window are never written here (see lookup-service.ts).

import { browser } from '#imports';
import type { KV } from '@/core/rate-guard';
import {
  isRecord,
  SOURCE_IDS,
  type Depth,
  type LookupResult,
  type SourceId,
  type SourceState,
} from '@/core/types';

export const TTL_FOUND_MS = 10 * 60_000;
export const TTL_EMPTY_MS = 5 * 60_000;
export const MAX_ENTRIES = 300;
/** LRU order of cached keys, least recently used first. */
export const INDEX_KEY = 'cache-index';
const RESULT_PREFIX = 'result:';
const KV_PREFIX = 'kv:';

/** The storage.session key of the result (and progress snapshots) for a lookup key. */
export function storageKey(key: string): string {
  return RESULT_PREFIX + key;
}

/** True when any source returned at least one discussion (of any tier). */
export function hasItems(r: LookupResult): boolean {
  return SOURCE_IDS.some((id) => {
    const state = r.sources[id];
    return state.status === 'ok' && state.items.length > 0;
  });
}

/** Within the TTL: 10 minutes when something was found, 5 minutes when empty. */
export function isFresh(r: LookupResult, now: number): boolean {
  const age = now - r.fetchedAt;
  return age >= 0 && age < (hasItems(r) ? TTL_FOUND_MS : TTL_EMPTY_MS);
}

export interface Want {
  depth: Depth;
  sources: Record<SourceId, boolean>;
  /** A private window: Reddit is `skipped` there, never `ok` (its data comes with the user's cookies). */
  incognito: boolean;
  /** Text posts count toward the badge, so an `auto` lookup needs the mentions too. */
  textPosts: boolean;
}

/**
 * The only source state that is a settled answer for the request: `off` (disabled), `skipped`
 * (Reddit in a private window) or `ok`, which a page the source can't look up answers with `skipped`
 * as well. Anything else (loading, deferred, paused, errors, sign-in or
 * rate problems) is re-run so the user is never stuck with a transient failure, and a result made
 * for the other kind of window is never handed out as is.
 */
function settledStatus(id: SourceId, want: Want): SourceState['status'] {
  if (!want.sources[id]) return 'off';
  return id === 'reddit' && want.incognito ? 'skipped' : 'ok';
}

/**
 * Whether a cached result can be returned as is, without running a lookup. A popup (`full`) lookup,
 * and an `auto` one while text posts are counted, also needs the mentions of every source that
 * answered; when they failed, the lookup runs again and only they are asked again (the discussions
 * are reused).
 */
export function canServe(r: LookupResult, want: Want, now: number): boolean {
  const needsMentions = want.depth === 'full' || want.textPosts;
  return (
    isFresh(r, now) &&
    (r.depth === 'full' || want.depth === 'auto') &&
    SOURCE_IDS.every((id) => {
      const state = r.sources[id];
      const unsupported = state.status === 'skipped' && state.reason === 'unsupported';
      const status = settledStatus(id, want);
      if (state.status !== status && !(status === 'ok' && unsupported)) return false;
      return (
        !needsMentions ||
        state.status !== 'ok' ||
        r.page.noLink !== undefined ||
        r.mentions?.[id]?.status === 'ok'
      );
    })
  );
}

export async function readResult(key: string): Promise<LookupResult | undefined> {
  const k = storageKey(key);
  const value = (await browser.storage.session.get(k))[k];
  return isLookupResult(value) ? value : undefined;
}

/**
 * Stores a snapshot or final result and marks the key most recently used. Writes to one key run in
 * call order. Never rejects: a lost write only costs a later cache miss.
 */
export function writeResult(key: string, result: LookupResult): Promise<void> {
  const k = storageKey(key);
  return serialized(k, async () => {
    try {
      await setWithQuotaRetry(k, result);
      await touchIndex(key);
    } catch (error) {
      console.warn('Find On: could not cache result', error);
    }
  });
}

/** Marks a key most recently used (call on cache hits). Never rejects. */
export function touch(key: string): Promise<void> {
  return touchIndex(key).catch((error: unknown) => {
    console.warn('Find On: could not update cache index', error);
  });
}

async function setWithQuotaRetry(k: string, value: unknown): Promise<void> {
  try {
    await browser.storage.session.set({ [k]: value });
  } catch {
    // Most likely the 10 MB session quota: drop the older half of the cache and try once more.
    await evictOldest(Math.ceil((await readIndex()).length / 2));
    await browser.storage.session.set({ [k]: value });
  }
}

function touchIndex(key: string): Promise<void> {
  return serialized(INDEX_KEY, async () => {
    const index = await readIndex();
    if (index.at(-1) === key) return;
    const existing = index.indexOf(key);
    if (existing !== -1) index.splice(existing, 1);
    index.push(key);
    const evicted = index.length > MAX_ENTRIES ? index.splice(0, index.length - MAX_ENTRIES) : [];
    await browser.storage.session.set({ [INDEX_KEY]: index });
    if (evicted.length > 0) await browser.storage.session.remove(evicted.map(storageKey));
  });
}

function evictOldest(count: number): Promise<void> {
  return serialized(INDEX_KEY, async () => {
    const index = await readIndex();
    const evicted = index.splice(0, count);
    await browser.storage.session.remove(evicted.map(storageKey));
    await browser.storage.session.set({ [INDEX_KEY]: index });
  });
}

async function readIndex(): Promise<string[]> {
  const value = (await browser.storage.session.get(INDEX_KEY))[INDEX_KEY];
  return Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : [];
}

/** KV store for the core (the rate guard's state), namespaced under `kv:` in storage.session. */
export function sessionKV(): KV {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const k = KV_PREFIX + key;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- KV is untyped storage by contract
      return (await browser.storage.session.get(k))[k] as T | undefined;
    },
    set: (key: string, value: unknown) => browser.storage.session.set({ [KV_PREFIX + key]: value }),
  };
}

// Per-key promise chains. Concurrent read-modify-write on one storage key loses updates otherwise.
// Module state is fine here: a chain only lives as long as the writes in it.
const chains = new Map<string, Promise<unknown>>();

/** Runs `task` after every earlier task for the same key has settled. */
export function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (chains.get(key) ?? Promise.resolve()).then(task);
  const tail = run.then(noop, noop);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

function noop(): void {}

export function isLookupResult(value: unknown): value is LookupResult {
  if (!isRecord(value)) return false;
  const { sources } = value;
  return (
    typeof value['key'] === 'string' &&
    typeof value['updatedAt'] === 'number' &&
    typeof value['fetchedAt'] === 'number' &&
    (value['depth'] === 'auto' || value['depth'] === 'full') &&
    isRecord(value['page']) &&
    isRecord(sources) &&
    SOURCE_IDS.every((id) => isRecord(sources[id])) &&
    (value['mentions'] === undefined || isRecord(value['mentions']))
  );
}
