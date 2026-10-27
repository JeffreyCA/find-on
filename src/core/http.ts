// Fetch wrapper with typed outcomes, per-attempt timeouts and bounded retries. Pure TS: the fetch
// function, clock and sleep are injected, so it runs in the service worker and in tests alike.
//
// Nothing here parses a body unless the response is OK JSON, so an HTML block page, a login wall or
// a captcha can never be mistaken for data (the v1 bug that started the rewrite).

import type { SourceId, SourceState } from './types';

/** Reddit's rate-limit headers, when present. */
export interface RateInfo {
  /** Requests left in the current window (`x-ratelimit-remaining`). */
  remaining: number;
  /** Epoch ms when the window resets (`x-ratelimit-reset`, seconds from now). */
  resetAt: number;
}

export interface ResponseMeta {
  status: number;
  contentType: string;
  rate?: RateInfo;
}

export type HttpOutcome =
  /** 2xx with a JSON content type and a body that parsed. */
  | { kind: 'ok'; data: unknown; meta: ResponseMeta }
  /** Redirected to a /login page (old.reddit.com when signed out). */
  | { kind: 'login'; meta: ResponseMeta }
  /** An HTML human-verification page ("Prove your humanity"). */
  | { kind: 'challenge'; meta: ResponseMeta }
  | { kind: 'rate-limited'; retryAt: number; meta: ResponseMeta }
  /**
   * Any other non-2xx status, including Reddit's 403 "blocked by network security" page, which
   * Reddit serves to signed-in users too.
   */
  | { kind: 'http'; meta: ResponseMeta }
  /** 2xx that is not JSON, or JSON that does not parse. */
  | { kind: 'format'; detail: string; meta: ResponseMeta }
  | { kind: 'network'; detail: string }
  | { kind: 'timeout' };

export type Failure = Exclude<HttpOutcome, { kind: 'ok' }>;

export interface HttpEnv {
  fetch: typeof fetch;
  now: () => number;
  /** Backoff between retries. Defaults to a timer; tests inject an instant one. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface FetchPolicy {
  credentials: 'include' | 'omit';
  /** Per attempt. */
  timeoutMs: number;
  /** Extra attempts after a transient failure: network error, timeout or 5xx. */
  retries: number;
  /** Whether a 429 also counts as transient (HN: yes; Reddit: no, it says when to come back). */
  retryRateLimited: boolean;
}

export const REQUEST_TIMEOUT_MS = 8000;
/** Wait after a 429 that names no reset time. */
const DEFAULT_RETRY_AFTER_S = 60;
const CHALLENGE_MARKERS = /prove your humanity|verify (?:that )?you(?:'|’)?re (?:a )?human/i;

/** 500 ms, 1 s, 2 s, ... before retry number `attempt + 1`. */
export function backoffMs(attempt: number): number {
  return 500 * 2 ** attempt;
}

/**
 * GETs `url` and classifies the response. Never rejects, except with the abort reason when
 * `signal` (the caller's, not the timeout) aborts.
 */
export async function getJson(
  url: string,
  policy: FetchPolicy,
  env: HttpEnv,
  signal: AbortSignal,
): Promise<HttpOutcome> {
  const sleep = env.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    // oxlint-disable-next-line no-await-in-loop -- retries are sequential by design
    const outcome = await attemptOnce(url, policy, env, signal);
    if (attempt >= policy.retries || !isTransient(outcome, policy)) return outcome;
    // oxlint-disable-next-line no-await-in-loop -- backoff between sequential attempts
    await sleep(backoffMs(attempt), signal);
  }
}

export function isTransient(outcome: HttpOutcome, policy: FetchPolicy): boolean {
  switch (outcome.kind) {
    case 'network':
    case 'timeout':
      return true;
    case 'http':
      return outcome.meta.status >= 500;
    case 'rate-limited':
      return policy.retryRateLimited;
    case 'ok':
    case 'login':
    case 'challenge':
    case 'format':
      break;
  }
  return false;
}

async function attemptOnce(
  url: string,
  policy: FetchPolicy,
  env: HttpEnv,
  signal: AbortSignal,
): Promise<HttpOutcome> {
  signal.throwIfAborted();
  const timeout = AbortSignal.timeout(policy.timeoutMs);
  try {
    const res = await env.fetch(url, {
      method: 'GET',
      credentials: policy.credentials,
      cache: 'no-store',
      redirect: 'follow',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.any([signal, timeout]),
    });
    return await classifyResponse(res, env.now());
  } catch (error) {
    signal.throwIfAborted();
    if (timeout.aborted) return { kind: 'timeout' };
    return { kind: 'network', detail: errorDetail(error) };
  }
}

/** Maps a response to an outcome, reading the body only when it decides the outcome. */
export async function classifyResponse(res: Response, now: number): Promise<HttpOutcome> {
  const contentType = res.headers.get('content-type') ?? '';
  const rate = rateInfo(res.headers, now);
  const meta: ResponseMeta = { status: res.status, contentType, ...(rate && { rate }) };

  if (res.redirected && isLoginUrl(res.url)) {
    discard(res);
    return { kind: 'login', meta };
  }
  if (res.status === 429) {
    discard(res);
    return { kind: 'rate-limited', retryAt: retryAt(res.headers, now, rate), meta };
  }
  if (res.ok && /\bjson\b/i.test(contentType)) {
    try {
      return { kind: 'ok', data: await res.json(), meta };
    } catch (error) {
      // An abort or timeout while reading the body propagates; only a parse error is "format".
      if (error instanceof SyntaxError) return { kind: 'format', detail: 'invalid JSON', meta };
      throw error;
    }
  }
  if (/\bhtml\b/i.test(contentType)) {
    const body = await res.text();
    if (CHALLENGE_MARKERS.test(body)) return { kind: 'challenge', meta };
  } else {
    discard(res);
  }
  if (!res.ok) return { kind: 'http', meta };
  return { kind: 'format', detail: `unexpected content type "${contentType}"`, meta };
}

/**
 * The source state for a failed request. Sign-in and challenge states only exist for Reddit; for
 * HN they are plain HTTP errors.
 */
export function failureState(outcome: Failure, source: SourceId): SourceState {
  switch (outcome.kind) {
    case 'login':
      return source === 'reddit' ? { status: 'signed-out' } : httpError(outcome.meta);
    case 'challenge':
      return source === 'reddit' ? { status: 'challenge' } : httpError(outcome.meta);
    case 'rate-limited':
      return { status: 'rate-limited', retryAt: outcome.retryAt };
    case 'http':
      return httpError(outcome.meta);
    case 'format':
      return { status: 'error', kind: 'format', detail: outcome.detail };
    case 'network':
      return { status: 'error', kind: 'network', detail: outcome.detail };
    case 'timeout':
      break;
  }
  return { status: 'error', kind: 'network', detail: 'timeout' };
}

/** 5xx is a server problem; any other unexpected status means the API changed under us. */
function httpError(meta: ResponseMeta): SourceState {
  const detail = `HTTP ${meta.status}${meta.contentType ? ` ${meta.contentType}` : ''}`;
  return meta.status >= 500
    ? { status: 'error', kind: 'http', detail }
    : { status: 'error', kind: 'format', detail };
}

function isLoginUrl(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith('/login');
  } catch {
    return false;
  }
}

function rateInfo(headers: Headers, now: number): RateInfo | undefined {
  const remaining = numberHeader(headers, 'x-ratelimit-remaining');
  const reset = numberHeader(headers, 'x-ratelimit-reset');
  if (remaining === undefined || reset === undefined) return undefined;
  return { remaining, resetAt: now + reset * 1000 };
}

function retryAt(headers: Headers, now: number, rate: RateInfo | undefined): number {
  if (rate) return rate.resetAt;
  const reset = numberHeader(headers, 'x-ratelimit-reset') ?? numberHeader(headers, 'retry-after');
  return now + (reset ?? DEFAULT_RETRY_AFTER_S) * 1000;
}

function numberHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Releases a body that will not be read (the old.reddit login page alone is about 330 KB). */
function discard(res: Response): void {
  res.body?.cancel().catch(() => {});
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
