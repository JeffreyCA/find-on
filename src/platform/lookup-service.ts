// The background's single entry point for lookups. It serves fresh cached results, runs at most one
// lookup per key at a time (other callers join it), writes progressive snapshots to storage.session
// for the popup, and lets at most MAX_AUTO_LOOKUPS automatic lookups run at once.
//
// Lookups for a private window write nothing: their page addresses must not outlive the window, and
// with Reddit skipped there, HN is the only source, so a snapshot would show nothing the response
// does not. They may still read normal-window results (canServe hands out only what fits them).
//
// In-flight state is kept in module memory on purpose: the fetches it tracks die with the service
// worker anyway, and the snapshots they leave behind are not settled answers, so they get re-run.

import { lookup, lookupKey, redditSignedIn, type LookupEnv } from '@/core/lookup';
import { RedditGuard } from '@/core/rate-guard';
import type { Depth, LookupResult, SourceId } from '@/core/types';
import { checkEligibility } from '@/core/url';
import { canServe, isFresh, readResult, sessionKV, touch, writeResult } from './cache';
import { getSettings } from './settings';

export const MAX_AUTO_LOOKUPS = 2;
const REDDIT_CHECK_TIMEOUT_MS = 20_000;

export const lookupEnv: LookupEnv = {
  // Wrapped: calling an unbound `fetch` from another object throws "Illegal invocation".
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  guard: new RedditGuard(sessionKV(), () => Date.now()),
};

export class IneligibleUrlError extends Error {
  constructor() {
    super("This page can't be checked.");
    this.name = 'IneligibleUrlError';
  }
}

export interface RunOptions {
  depth: Depth;
  /** Incognito tabs never send Reddit requests. */
  incognito: boolean;
  /** User-initiated re-check: skips the cache; the core also bypasses the Reddit rate guard. */
  force?: boolean;
  /**
   * Withdraws this caller's interest (e.g. its tab navigated away). The shared lookup is aborted
   * once no caller is waiting for it.
   */
  signal?: AbortSignal;
  /** Automatic lookups: the site filter's blocklist, applied to the page a thread links to. */
  isBlocked?: (url: string) => boolean;
}

interface Flight {
  readonly depth: Depth;
  readonly incognito: boolean;
  readonly controller: AbortController;
  readonly promise: Promise<LookupResult>;
  /** Lets a queued automatic lookup start without waiting for a free slot. */
  readonly promote: () => void;
  waiters: number;
}

const flights = new Map<string, Flight>();

/**
 * Runs (or joins, or serves from cache) a lookup for `url`. Rejects with IneligibleUrlError.
 * Results and snapshots are stored under `lookupKey(url)`, so pages can find them from the same URL.
 */
export async function runLookup(
  url: string,
  opts: RunOptions,
): Promise<{ key: string; result: LookupResult }> {
  const eligibility = checkEligibility(url);
  const key = eligibility.ok ? lookupKey(url) : null;
  if (!eligibility.ok || key === null) throw new IneligibleUrlError();
  const { sources } = await getSettings();
  // Only the sanitized URL (no secret-looking parameters) is handed on to the network code.
  const sanitized = eligibility.url;
  const result = await obtain(key, sanitized, { ...opts, force: opts.force ?? false }, sources);
  return { key, result };
}

async function obtain(
  key: string,
  url: string,
  opts: RunOptions & { force: boolean },
  sources: Record<SourceId, boolean>,
): Promise<LookupResult> {
  opts.signal?.throwIfAborted();
  const flight = liveFlight(key);
  if (flight !== undefined) {
    if (!opts.force && covers(flight, opts)) return join(flight, opts.signal);
    // Run after it instead: its answer becomes the cached result (or `previous`) for this one. A
    // user-initiated lookup must not wait for other pages' automatic lookups to free a slot.
    if (opts.depth === 'full' || opts.force) flight.promote();
    await settle(flight.promise, opts.signal);
    return obtain(key, url, opts, sources);
  }

  const cached = opts.force ? undefined : await readResult(key);
  // Another caller may have started a lookup while the cache was being read.
  if (liveFlight(key) !== undefined) return obtain(key, url, opts, sources);
  const now = Date.now();
  const want = { depth: opts.depth, sources, incognito: opts.incognito };
  if (cached !== undefined && canServe(cached, want, now)) {
    void touch(key);
    return cached;
  }
  const previous = cached !== undefined && isFresh(cached, now) ? cached : undefined;
  return join(startFlight(key, url, opts, sources, previous), opts.signal);
}

/** Whether Reddit accepts the user's session (null when that can't be determined). */
export function checkRedditSignIn(): Promise<boolean | null> {
  return redditSignedIn(lookupEnv, AbortSignal.timeout(REDDIT_CHECK_TIMEOUT_MS));
}

/**
 * The running lookup for `key`, if any. A lookup every caller abandoned is aborted but stays in
 * `flights` until its requests wind down; it must not be joined, so a new one starts instead.
 */
function liveFlight(key: string): Flight | undefined {
  const flight = flights.get(key);
  return flight?.controller.signal.aborted === false ? flight : undefined;
}

/** A running full lookup also answers an auto request; an auto lookup cannot answer a full one. */
function covers(flight: Flight, opts: RunOptions): boolean {
  return (flight.depth === 'full' || opts.depth === 'auto') && flight.incognito === opts.incognito;
}

function startFlight(
  key: string,
  url: string,
  opts: RunOptions & { force: boolean },
  sources: Record<SourceId, boolean>,
  previous: LookupResult | undefined,
): Flight {
  const { depth, incognito, force } = opts;
  const controller = new AbortController();
  const promoted = Promise.withResolvers<void>();
  const promise = (async () => {
    // Automatic lookups queue for a slot; user-initiated ones never wait behind them.
    const release =
      depth === 'auto' ? await autoSlots.acquire(controller.signal, promoted.promise) : noop;
    let done = false;
    try {
      const result = await lookup(
        url,
        {
          depth,
          sources: { ...sources },
          incognito,
          force,
          signal: controller.signal,
          ...(previous !== undefined && { previous }),
          ...(opts.isBlocked && { isBlocked: opts.isBlocked }),
          ...(!incognito && {
            onProgress: (snapshot: LookupResult) => {
              if (!done) void writeResult(key, snapshot);
            },
          }),
        },
        lookupEnv,
      );
      done = true;
      if (!incognito) await writeResult(key, result);
      return result;
    } finally {
      done = true;
      release();
    }
  })();

  const flight: Flight = {
    depth,
    incognito,
    controller,
    promise,
    promote: () => promoted.resolve(),
    waiters: 0,
  };
  flights.set(key, flight);
  const forget = () => {
    if (flights.get(key) === flight) flights.delete(key);
  };
  void promise.then(forget, forget);
  return flight;
}

/** Waits for a flight's result as one of its waiters. */
function join(flight: Flight, signal: AbortSignal | undefined): Promise<LookupResult> {
  flight.waiters += 1;
  return new Promise((resolve, reject) => {
    let left = false;
    const leave = (abandon: boolean) => {
      if (left) return;
      left = true;
      signal?.removeEventListener('abort', onAbort);
      flight.waiters -= 1;
      if (abandon && flight.waiters === 0) flight.controller.abort(signal?.reason);
    };
    const onAbort = () => {
      leave(true);
      reject(signal?.reason);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    flight.promise.then(
      (result) => {
        leave(false);
        resolve(result);
      },
      (error: unknown) => {
        leave(false);
        reject(error);
      },
    );
  });
}

/** Resolves once `promise` settles either way; rejects early if `signal` aborts. */
function settle(promise: Promise<unknown>, signal: AbortSignal | undefined): Promise<void> {
  const done = promise.then(noop, noop);
  if (signal === undefined) return done;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    void done.then(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
  });
}

/**
 * Counting semaphore whose waiters can give up through an AbortSignal, or skip the queue when
 * `skip` resolves (they then run outside the limit and hold no slot).
 */
class Slots {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly capacity: number) {}

  acquire(signal: AbortSignal, skip?: Promise<void>): Promise<() => void> {
    signal.throwIfAborted();
    if (this.active < this.capacity) {
      this.active += 1;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve, reject) => {
      /** Removes this waiter from the queue; false when it was already granted or removed. */
      const leave = (): boolean => {
        const index = this.queue.indexOf(grant);
        if (index === -1) return false;
        this.queue.splice(index, 1);
        signal.removeEventListener('abort', onAbort);
        return true;
      };
      const grant = () => {
        signal.removeEventListener('abort', onAbort);
        this.active += 1;
        resolve(this.releaser());
      };
      const onAbort = () => {
        if (leave()) reject(signal.reason);
      };
      this.queue.push(grant);
      signal.addEventListener('abort', onAbort, { once: true });
      void skip?.then(() => {
        if (leave()) resolve(noop);
      });
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.queue.shift()?.();
    };
  }
}

const autoSlots = new Slots(MAX_AUTO_LOOKUPS);

function noop(): void {}
