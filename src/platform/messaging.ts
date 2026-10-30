// Typed request/response messaging between extension pages and the background service worker.
// Chrome serializes messages as JSON, so payloads must be plain data. A handler error travels back
// as `{ error }` and is rethrown on the sending side.

import { browser, type Browser } from '#imports';
import { isRecord, type Depth, type LookupResult } from '@/core/types';
import { isLookupResult } from './cache';

export type Request =
  | {
      type: 'lookup';
      url: string;
      depth: Depth;
      force?: boolean;
      /** The tab the result belongs to (its badge is updated). */
      tabId?: number;
      /** The window the popup belongs to: decides whether the lookup is private. */
      windowId?: number;
    }
  | { type: 'reddit-check' };

export type ResponseFor<R extends Request> = R extends { type: 'lookup' }
  ? LookupResult
  : R extends { type: 'reddit-check' }
    ? { signedIn: boolean | null }
    : never;

/** Wire format of a response. */
type Envelope = { result?: unknown } | { error: string };

/** Sends a request to the background and resolves with its response, or rejects with its error. */
export async function send<R extends Request>(req: R): Promise<ResponseFor<R>> {
  const envelope: unknown = await browser.runtime.sendMessage(req);
  if (!isRecord(envelope)) throw new Error(`No response to "${req.type}"`);
  if (typeof envelope['error'] === 'string') throw new Error(envelope['error']);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the background answers each request type with its ResponseFor
  return envelope['result'] as ResponseFor<R>;
}

/**
 * Registers the background's request handler. Call it synchronously at service worker start.
 * Messages that are not a well-formed Request are left for other listeners.
 */
export function onRequest(
  handler: (req: Request, sender: Browser.runtime.MessageSender) => Promise<unknown>,
): void {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isRequest(message)) return false;
    void handler(message, sender).then(
      (result) => sendResponse({ result } satisfies Envelope),
      (error: unknown) => sendResponse({ error: errorMessage(error) } satisfies Envelope),
    );
    // Keeps the channel open until sendResponse runs (Promise-returning listeners need Chrome 148).
    return true;
  });
}

export function isRequest(m: unknown): m is Request {
  if (!isRecord(m)) return false;
  switch (m['type']) {
    case 'lookup':
      return (
        typeof m['url'] === 'string' &&
        (m['depth'] === 'auto' || m['depth'] === 'full') &&
        (m['force'] === undefined || typeof m['force'] === 'boolean') &&
        (m['tabId'] === undefined || Number.isInteger(m['tabId']))
      );
    case 'reddit-check':
      return true;
    default:
      return false;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}

/** Background to popup: a snapshot of a private-window lookup, which is never stored. */
interface ProgressMessage {
  type: 'lookup-progress';
  /** The lookup key (`lookupKey(url)`). */
  key: string;
  result: LookupResult;
}

/** Hands a private-window lookup's snapshot to an open popup. With none open, it goes nowhere. */
export function sendProgress(key: string, result: LookupResult): void {
  const message: ProgressMessage = { type: 'lookup-progress', key, result };
  browser.runtime.sendMessage(message).catch(() => {
    // No page is listening.
  });
}

/** Calls `cb` with each private-window lookup snapshot the background sends. */
export function onProgress(cb: (key: string, result: LookupResult) => void): () => void {
  const listener = (message: unknown) => {
    if (!isRecord(message) || message['type'] !== 'lookup-progress') return false;
    const { key, result } = message;
    if (typeof key === 'string' && isLookupResult(result)) cb(key, result);
    return false;
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}

/** `storage.session` key for the context-menu handoff `{ url, at }`. */
export const PENDING_URL_KEY = 'pending-url';

/** Value stored under PENDING_URL_KEY. `at` is epoch ms; the popup ignores entries older than 10 s. */
export interface PendingUrl {
  url: string;
  at: number;
}
