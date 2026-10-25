// Reddit rate guard: a token bucket for automatic lookups, a pause when Reddit's own
// rate-limit headers run low, a circuit breaker after sign-in or human-verification failures, and a
// memory of old.reddit.com walls. Pure logic over an injected KV store and clock; in the extension
// the KV is storage.session, so the state survives service worker restarts. Use one guard per store:
// it serializes its own reads and writes.

import type { HttpOutcome } from './http';
import { isRecord, type Depth, type SourceState } from './types';

/** Minimal async key-value store (backed by `storage.session` in the extension, a Map in tests). */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export const BUCKET_CAPACITY = 8;
/** Tokens regained per millisecond: 8 per minute. */
const REFILL_PER_MS = 8 / 60_000;
/** Below this many requests left in Reddit's window, automatic lookups wait for the reset. */
export const LOW_REMAINING = 10;
export const BREAKER_MS = 5 * 60_000;
/** How long old.reddit.com is skipped after it showed a login wall while www.reddit.com worked. */
export const OLD_WALL_MS = 30 * 60_000;

const STATE_KEY = 'reddit-guard';

export interface GuardState {
  tokens: number;
  /** When `tokens` was last brought up to date (epoch ms). */
  refilledAt: number;
  /** `x-ratelimit-remaining` ran low: automatic requests wait until Reddit's window resets. */
  pausedUntil: number;
  /** Reddit answered 429: nothing but a forced retry is sent until then. */
  limitedUntil: number;
  /** Signed out or challenged: automatic requests stop until then. */
  breakerUntil: number;
  /** old.reddit.com asks this user to log in although www.reddit.com works. */
  oldWalledUntil: number;
}

export type Admission =
  | { ok: true }
  | { ok: false; state: Extract<SourceState, { status: 'deferred' | 'paused' | 'rate-limited' }> };

export interface AdmitOptions {
  depth: Depth;
  /** User-initiated retry: skips every check. */
  force: boolean;
  /** Requests an automatic lookup is about to send; all of them must fit in the bucket. */
  cost: number;
}

export class RedditGuard {
  readonly #kv: KV;
  readonly #now: () => number;
  /** Two lookups running at once must not both spend the same tokens. */
  #chain: Promise<unknown> = Promise.resolve();

  constructor(kv: KV, now: () => number) {
    this.#kv = kv;
    this.#now = now;
  }

  /**
   * Whether a Reddit lookup may send requests now. Automatic lookups take `cost` tokens, all or
   * nothing; user-initiated (`full`) lookups only wait out an explicit 429.
   */
  admit({ depth, force, cost }: AdmitOptions): Promise<Admission> {
    return this.#update((s, now) => {
      if (force) return { ok: true };
      if (s.limitedUntil > now) {
        return { ok: false, state: { status: 'rate-limited', retryAt: s.limitedUntil } };
      }
      if (depth === 'full') return { ok: true };
      const pausedUntil = Math.max(s.breakerUntil, s.pausedUntil);
      if (pausedUntil > now)
        return { ok: false, state: { status: 'paused', retryAt: pausedUntil } };
      if (s.tokens < cost) return { ok: false, state: { status: 'deferred' } };
      s.tokens -= cost;
      return { ok: true };
    });
  }

  /** Records what one response says about Reddit's limits. */
  observe(outcome: HttpOutcome): Promise<void> {
    if (outcome.kind === 'network' || outcome.kind === 'timeout') return Promise.resolve();
    const { rate } = outcome.meta;
    return this.#update((s) => {
      if (outcome.kind === 'rate-limited') {
        s.limitedUntil = Math.max(s.limitedUntil, outcome.retryAt);
      } else if (outcome.kind === 'ok') {
        s.limitedUntil = 0;
      }
      if (rate && rate.remaining < LOW_REMAINING) {
        s.pausedUntil = Math.max(s.pausedUntil, rate.resetAt);
      }
    });
  }

  /**
   * Records the end result of a lookup's Reddit requests. Any success closes the breaker; a lookup
   * that only got sign-in walls, or met a human-verification page, opens it.
   */
  conclude(result: { anyOk: boolean; signedOut: boolean; challenged: boolean }): Promise<void> {
    return this.#update((s, now) => {
      if (result.challenged || (!result.anyOk && result.signedOut)) {
        s.breakerUntil = now + BREAKER_MS;
      } else if (result.anyOk) {
        s.breakerUntil = 0;
      }
    });
  }

  oldRedditWalled(): Promise<boolean> {
    return this.#update((s, now) => s.oldWalledUntil > now);
  }

  markOldRedditWalled(): Promise<void> {
    return this.#update((s, now) => {
      s.oldWalledUntil = now + OLD_WALL_MS;
    });
  }

  /** Read-modify-write of the stored state, one at a time. */
  #update<T>(mutate: (state: GuardState, now: number) => T): Promise<T> {
    const run = this.#chain.then(async () => {
      const now = this.#now();
      const stored = await this.#kv.get<unknown>(STATE_KEY);
      const state = refill(parseState(stored, now), now);
      const before = JSON.stringify(state);
      const result = mutate(state, now);
      if (JSON.stringify(state) !== before || !isGuardState(stored)) {
        await this.#kv.set(STATE_KEY, state);
      }
      return result;
    });
    this.#chain = run.catch(() => {});
    return run;
  }
}

function refill(s: GuardState, now: number): GuardState {
  // A clock that went backwards refills nothing.
  const elapsed = Math.max(0, now - s.refilledAt);
  return {
    ...s,
    tokens: Math.min(BUCKET_CAPACITY, s.tokens + elapsed * REFILL_PER_MS),
    refilledAt: now,
  };
}

function initialState(now: number): GuardState {
  return {
    tokens: BUCKET_CAPACITY,
    refilledAt: now,
    pausedUntil: 0,
    limitedUntil: 0,
    breakerUntil: 0,
    oldWalledUntil: 0,
  };
}

function parseState(value: unknown, now: number): GuardState {
  return isGuardState(value) ? { ...value } : initialState(now);
}

function isGuardState(value: unknown): value is GuardState {
  if (!isRecord(value)) return false;
  const v = value;
  return (
    [
      'tokens',
      'refilledAt',
      'pausedUntil',
      'limitedUntil',
      'breakerUntil',
      'oldWalledUntil',
    ] as const
  ).every((k) => typeof v[k] === 'number' && Number.isFinite(v[k]));
}
