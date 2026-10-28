// The popup's lookup controller: finds the target page, asks the background for a `full` lookup and
// renders progress from the snapshots the background writes to storage.session while it runs (or,
// for a private window, sends by message).

import { browser } from '#imports';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { lookupKey } from '@/core/lookup';
import { SOURCE_IDS, type LookupResult } from '@/core/types';
import { isLookupResult, readResult, storageKey } from '@/platform/cache';
import { onProgress, send } from '@/platform/messaging';
import { initialSource, popupWindow, toTarget, typedSource, type Target } from './target';

export interface PopupController {
  /** Null until the target page is known. */
  target: Target | null;
  result: LookupResult | null;
  /** A lookup request is in flight. */
  busy: boolean;
  incognito: boolean;
  /** Looks up what was typed into the URL field (or the current page again, if unchanged). */
  check: (input: string) => void;
  /** Looks the page up again; `force` bypasses the cache and the Reddit rate guard. */
  recheck: (force: boolean) => void;
}

interface State {
  target: Target | null;
  result: LookupResult | null;
  busy: boolean;
  incognito: boolean;
}

export function usePopup(): PopupController {
  const [state, setState] = useState<State>({
    target: null,
    result: null,
    busy: false,
    incognito: false,
  });
  // Each lookup gets an id; answers for an older one are dropped.
  const runRef = useRef(0);
  // The storage.session key of the current lookup's snapshots; null when not following them.
  const watchRef = useRef<string | null>(null);
  // In a private window: the lookup key whose snapshots arrive by message; null when not following.
  const progressRef = useRef<string | null>(null);
  const incognitoRef = useRef(false);
  const windowIdRef = useRef<number | undefined>(undefined);

  const accept = useCallback((run: number, next: LookupResult) => {
    if (run !== runRef.current) return;
    setState((s) => ({ ...s, result: mergeResult(s.result, next) }));
  }, []);

  const start = useCallback(
    (target: Target, force: boolean) => {
      const run = ++runRef.current;
      setState((s) => ({
        ...s,
        target,
        // A new page starts empty; the same page keeps what it shows until fresh states arrive.
        result: s.result !== null && sameTarget(s.target, target) ? s.result : null,
        busy: target.kind === 'page',
      }));
      watchRef.current = null;
      progressRef.current = null;
      if (target.kind !== 'page') return;

      const key = lookupKey(target.url);
      // Private windows store nothing, and a stored entry may hold a normal window's Reddit data:
      // their snapshots come by message.
      if (key !== null && incognitoRef.current) progressRef.current = key;
      else if (key !== null) {
        watchRef.current = storageKey(key);
        // A result already stored for this page shows at once; the lookup then refreshes it.
        readResult(key).then(
          (stored) => {
            if (stored !== undefined) accept(run, stored);
          },
          () => {},
        );
      }

      send({
        type: 'lookup',
        url: target.url,
        depth: 'full',
        ...(force && { force: true }),
        ...(target.tabId !== undefined && { tabId: target.tabId }),
        ...(windowIdRef.current !== undefined && { windowId: windowIdRef.current }),
      }).then(
        (result) => {
          if (run !== runRef.current) return;
          // The answer is final: later snapshots belong to another lookup (e.g. an automatic one).
          watchRef.current = null;
          progressRef.current = null;
          setState((s) => ({ ...s, result: mergeResult(s.result, result), busy: false }));
        },
        (error: unknown) => {
          if (run !== runRef.current) return;
          console.error('Find On: lookup failed', error);
          watchRef.current = null;
          progressRef.current = null;
          // Sources still loading are shown as failed (see buildModel).
          setState((s) => ({ ...s, busy: false }));
        },
      );
    },
    [accept],
  );

  useEffect(() => {
    const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
      const key = watchRef.current;
      const value = key === null ? undefined : changes[key]?.newValue;
      if (isLookupResult(value)) accept(runRef.current, value);
    };
    browser.storage.session.onChanged.addListener(onChanged);
    const stopProgress = onProgress((key, result) => {
      if (key === progressRef.current) accept(runRef.current, result);
    });

    let live = true;
    Promise.all([initialSource(location.search, Date.now()), popupWindow()]).then(
      ([source, win]) => {
        if (!live) return;
        incognitoRef.current = win.incognito;
        windowIdRef.current = win.id;
        setState((s) => ({ ...s, incognito: win.incognito }));
        start(toTarget(source), false);
      },
      (error: unknown) => console.error('Find On: finding the page failed', error),
    );
    return () => {
      live = false;
      browser.storage.session.onChanged.removeListener(onChanged);
      stopProgress();
    };
  }, [accept, start]);

  const { target, result } = state;
  const check = useCallback(
    (input: string) => {
      const text = input.trim();
      // For a discussion page the field shows the page it links to; either form is "unchanged".
      if (target?.kind === 'page' && (text === target.display || text === result?.page.display)) {
        start(target, false);
      } else {
        start(toTarget(typedSource(input)), false);
      }
    },
    [target, result, start],
  );
  const recheck = useCallback(
    (force: boolean) => {
      if (target?.kind === 'page') start(target, force);
    },
    [target, start],
  );

  return { ...state, check, recheck };
}

function sameTarget(a: Target | null, b: Target): boolean {
  return a?.kind === 'page' && b.kind === 'page' && a.url === b.url;
}

/**
 * Takes a newer snapshot of the same lookup. While a source or its mentions are loading again (a
 * re-check, a retry, or the first snapshot of a lookup that will reuse them), what they showed
 * before stays on screen, so results never blink out and back in. An automatic lookup never looks
 * for mentions, so its snapshots keep the ones shown for every source it has not given up on, as
 * long as the page is the one they were found for.
 */
export function mergeResult(prev: LookupResult | null, next: LookupResult): LookupResult {
  if (prev === null || prev.key !== next.key) return next;
  if (next.updatedAt < prev.updatedAt) return prev;
  let keptSources = false;
  const sources = { ...next.sources };
  for (const id of SOURCE_IDS) {
    if (sources[id].status === 'loading' && prev.sources[id].status === 'ok') {
      sources[id] = prev.sources[id];
      keptSources = true;
    }
  }
  // Until the page is resolved again, keep the earlier resolution (it belongs to the kept items).
  const resolved = next.page.resolvedFrom !== undefined || next.page.noLink !== undefined;
  const page = keptSources && !resolved ? prev.page : next.page;
  // Mentions are kept only for the page they were found for.
  let keptMentions = false;
  const mentions = { ...next.mentions };
  if (page.url === prev.page.url) {
    for (const id of SOURCE_IDS) {
      const before = prev.mentions?.[id];
      const status = next.sources[id].status;
      const waiting =
        mentions[id]?.status === 'loading' ||
        (next.depth === 'auto' &&
          mentions[id] === undefined &&
          (status === 'loading' || status === 'ok'));
      if (waiting && before?.status === 'ok') {
        mentions[id] = before;
        keptMentions = true;
      }
    }
  }
  if (!keptSources && !keptMentions) return next;
  return { ...next, sources, ...(Object.keys(mentions).length > 0 && { mentions }), page };
}
