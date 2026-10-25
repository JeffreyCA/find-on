// Helpers for core unit tests (not imported by any entrypoint): recorded fixtures, a routing fake
// fetch that records calls, canned responses and an in-memory KV.

import { readFileSync } from 'node:fs';
import type { LookupEnv } from './lookup';
import { RedditGuard, type KV } from './rate-guard';

export function fixtureText(name: string): string {
  return readFileSync(new URL(`./providers/__fixtures__/${name}`, import.meta.url), 'utf8');
}

export function fixtureJson(name: string): unknown {
  return JSON.parse(fixtureText(name));
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', ...headers },
  });
}

export function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

/** What `fetch` returns after following a redirect to `finalUrl` (Response can't be built so). */
export function redirected(finalUrl: string, res: Response): Response {
  Object.defineProperty(res, 'redirected', { value: true });
  Object.defineProperty(res, 'url', { value: finalUrl });
  return res;
}

/** old.reddit.com's answer to a signed-out request: a followed redirect to the login page. */
export function oldRedditLoginWall(): Response {
  return redirected(
    'https://old.reddit.com/login/?reason=lor2&dest=https%3A%2F%2Fold.reddit.com%2Fapi%2Finfo.json',
    html('<!DOCTYPE html><html><head><title>Welcome to Reddit</title></head></html>'),
  );
}

/** www.reddit.com's answer to a signed-out request: the 403 "blocked by network security" page. */
export function wwwRedditBlocked(): Response {
  return html(fixtureText('reddit-blocked-403.html'), 403, { 'retry-after': '0' });
}

export interface Call {
  url: URL;
  init: RequestInit | undefined;
}

export type Route = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/** A fetch that records every call and answers through `route`. */
export function fakeFetch(route: Route): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push({ url, init });
    init?.signal?.throwIfAborted();
    return route(url, init);
  };
  return { fetch: fetchFn, calls };
}

export function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test store mirrors the untyped KV contract
    get: <T>(key: string) => Promise.resolve(structuredClone(data.get(key)) as T | undefined),
    set: (key: string, value: unknown) => {
      data.set(key, structuredClone(value));
      return Promise.resolve();
    },
  };
}

/** A lookup environment with a fixed clock, a fresh rate guard and instant backoff. */
export function testEnv(
  fetchFn: typeof fetch,
  now = 1_760_000_000_000,
): LookupEnv & { clock: { now: number } } {
  const clock = { now };
  const clockNow = () => clock.now;
  return {
    fetch: fetchFn,
    now: clockNow,
    guard: new RedditGuard(memoryKV(), clockNow),
    sleep: () => Promise.resolve(),
    clock,
  };
}
