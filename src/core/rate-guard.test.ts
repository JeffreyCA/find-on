import { describe, expect, it } from 'vitest';
import type { HttpOutcome } from './http';
import { BREAKER_MS, RedditGuard } from './rate-guard';
import { memoryKV } from './test-utils';

function setup() {
  const clock = { now: 1_760_000_000_000 };
  const kv = memoryKV();
  return { clock, kv, guard: new RedditGuard(kv, () => clock.now) };
}

const ok = (rate?: { remaining: number; resetAt: number }): HttpOutcome => ({
  kind: 'ok',
  data: {},
  meta: { status: 200, contentType: 'application/json', ...(rate && { rate }) },
});

const auto = { depth: 'auto', force: false, cost: 2 } as const;
const full = { depth: 'full', force: false, cost: 0 } as const;

/** Four automatic lookups at cost 2 empty the bucket of 8. */
async function drain(guard: RedditGuard): Promise<boolean[]> {
  const results = await Promise.all(Array.from({ length: 4 }, () => guard.admit(auto)));
  return results.map((r) => r.ok);
}

describe('RedditGuard', () => {
  it('spends 8 tokens per minute on automatic lookups, all or nothing', async () => {
    const { guard, clock } = setup();
    expect(await drain(guard)).toEqual([true, true, true, true]);
    expect(await guard.admit(auto)).toEqual({ ok: false, state: { status: 'deferred' } });
    // User-initiated lookups never wait for tokens.
    expect(await guard.admit(full)).toEqual({ ok: true });
    clock.now += 7_500; // one token back
    expect(await guard.admit(auto)).toMatchObject({ ok: false });
    clock.now += 7_500; // two tokens
    expect(await guard.admit(auto)).toEqual({ ok: true });
  });

  it('pauses automatic lookups until the reset when Reddit says fewer than 10 requests remain', async () => {
    const { guard, clock } = setup();
    const resetAt = clock.now + 120_000;
    await guard.observe(ok({ remaining: 9, resetAt }));
    expect(await guard.admit(auto)).toEqual({
      ok: false,
      state: { status: 'paused', retryAt: resetAt },
    });
    expect(await guard.admit(full)).toEqual({ ok: true });
    clock.now = resetAt;
    expect(await guard.admit(auto)).toEqual({ ok: true });
  });

  it('holds every request but a forced one after a 429', async () => {
    const { guard, clock } = setup();
    const retryAt = clock.now + 40_000;
    await guard.observe({ kind: 'rate-limited', retryAt, meta: { status: 429, contentType: '' } });
    const limited = { ok: false, state: { status: 'rate-limited', retryAt } };
    expect(await guard.admit(auto)).toEqual(limited);
    expect(await guard.admit(full)).toEqual(limited);
    expect(await guard.admit({ ...full, force: true })).toEqual({ ok: true });
    // A success (the forced retry went through) lifts it.
    await guard.observe(ok());
    expect(await guard.admit(full)).toEqual({ ok: true });
  });

  it('opens the breaker for 5 minutes after a sign-in wall; any success closes it', async () => {
    const { guard, clock } = setup();
    await guard.conclude({ anyOk: false, signedOut: true, challenged: false });
    const paused = { ok: false, state: { status: 'paused', retryAt: clock.now + BREAKER_MS } };
    expect(await guard.admit(auto)).toEqual(paused);
    expect(await guard.admit(full)).toEqual({ ok: true });
    await guard.conclude({ anyOk: true, signedOut: false, challenged: false });
    expect(await guard.admit(auto)).toEqual({ ok: true });

    await guard.conclude({ anyOk: false, signedOut: false, challenged: true });
    expect(await guard.admit(auto)).toMatchObject({ state: { status: 'paused' } });
    clock.now += BREAKER_MS;
    expect(await guard.admit(auto)).toEqual({ ok: true });
  });
});
