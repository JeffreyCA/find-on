// Hooks for extension pages: live storage values, settings, a ticking clock and the Reddit sign-in
// check.

import { type WxtStorageItem } from '#imports';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { send } from '@/platform/messaging';
import { getSettings, saveSettings, watchSettings, type Settings } from '@/platform/settings';

/**
 * The current value of a storage item, kept up to date with `item.watch`; undefined until the first
 * read completes.
 */
export function useStorageItem<T, M extends Record<string, unknown>>(
  item: WxtStorageItem<T, M>,
): T | undefined {
  return useWatched(
    () => item.getValue(),
    (set) => item.watch((next) => set(next ?? item.fallback)),
  );
}

/** The settings, with defaults for anything not stored; undefined until the first read. */
export function useSettings(): Settings | undefined {
  return useWatched(getSettings, watchSettings);
}

/** Reads a value once and follows its changes. A change seen before the read finishes wins. */
function useWatched<T>(read: () => Promise<T>, watch: (set: (value: T) => void) => () => void) {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let changed = false;
    let live = true;
    const unwatch = watch((next) => {
      changed = true;
      setValue(() => next);
    });
    read().then(
      (initial) => {
        if (live && !changed) setValue(() => initial);
      },
      (error: unknown) => console.error('Find On: reading storage failed', error),
    );
    return () => {
      live = false;
      unwatch();
    };
    // The item is fixed for the component's lifetime.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

/** Writes a change to the settings on top of the current value. */
export async function updateSettings(
  change: Partial<Settings> | ((current: Settings) => Settings),
): Promise<void> {
  const current = await getSettings();
  await saveSettings(typeof change === 'function' ? change(current) : { ...current, ...change });
}

/** `Date.now()`, refreshed every `intervalMs` while `active`. */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

export type RedditSignIn = 'unknown' | 'checking' | 'signed-in' | 'signed-out' | 'error';

/**
 * Reddit sign-in status from the background's `reddit-check` (one Reddit request per check).
 * `auto` checks on mount; `onFocus` checks again when the page regains focus while signed out (or
 * after a failed check), for pages that send the user off to sign in and expect them back.
 */
export function useRedditSignIn({ auto = false, onFocus = false } = {}): {
  status: RedditSignIn;
  check: () => void;
} {
  const [status, setStatus] = useState<RedditSignIn>(auto ? 'checking' : 'unknown');
  const latestRef = useRef(0);
  const check = useCallback(() => {
    const id = ++latestRef.current;
    setStatus('checking');
    send({ type: 'reddit-check' }).then(
      ({ signedIn }) => {
        if (id === latestRef.current) {
          setStatus(signedIn === null ? 'error' : signedIn ? 'signed-in' : 'signed-out');
        }
      },
      () => {
        if (id === latestRef.current) setStatus('error');
      },
    );
  }, []);
  useEffect(() => {
    if (auto) check();
  }, [auto, check]);
  useEffect(() => {
    if (!onFocus || (status !== 'signed-out' && status !== 'error')) return undefined;
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [onFocus, status, check]);
  return { status, check };
}
