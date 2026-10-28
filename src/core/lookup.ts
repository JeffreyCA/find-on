// Lookup orchestration: page keys, discussion-page resolution, the providers (run in
// parallel and independently, so one failing never blocks the other), reuse of an earlier `auto`
// result, progress snapshots. `full` lookups also search each source for mentions (threads that
// link to the page) once its discussions have answered. Pure TS, no browser APIs.

import type { HttpEnv } from './http';
import type { OkState } from './providers/common';
import {
  lookupHn,
  lookupHnMentions,
  resolveHnItem,
  toDiscussion as hnDiscussion,
  type AlgoliaHit,
  type HnContext,
  type HnItem,
} from './providers/hn';
import {
  checkSignedIn,
  lookupReddit,
  lookupRedditMentions,
  resolveRedditThread,
  type RedditContext,
  type RedditPost,
  type RedditThread,
} from './providers/reddit';
import type { RedditGuard } from './rate-guard';
import {
  SOURCE_IDS,
  type Depth,
  type Discussion,
  type LookupResult,
  type MentionState,
  type PageInfo,
  type SourceId,
  type SourceState,
} from './types';
import {
  checkEligibility,
  computeKeys,
  displayUrl,
  RULES_VERSION,
  splitIdentity,
  type UrlKeys,
} from './url';

export interface LookupEnv {
  fetch: typeof fetch;
  now: () => number;
  /** The Reddit rate guard: one per environment, since it serializes its own state. */
  guard: RedditGuard;
  /** Backoff between retries; defaults to a timer. Tests inject an instant one. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface LookupOptions {
  depth: Depth;
  sources: { hn: boolean; reddit: boolean };
  incognito: boolean;
  /** User-initiated retry: bypass the Reddit token bucket and breaker. */
  force?: boolean;
  /** Cached result to build on (e.g. `full` after `auto`). */
  previous?: LookupResult;
  signal: AbortSignal;
  /** Called whenever a source state changes. */
  onProgress?: (r: LookupResult) => void;
  /**
   * For automatic lookups: true for URLs the site filter blocks. A discussion page that links to one
   * is not looked up any further, so the blocked URL is never sent.
   */
  isBlocked?: (url: string) => boolean;
}

/** `${RULES_VERSION}:${exactKey}`, or null when the URL is not eligible. */
export function lookupKey(url: string): string | null {
  const page = eligiblePage(url);
  return page ? `${RULES_VERSION}:${page.keys.exact}` : null;
}

function eligiblePage(url: string): { url: string; keys: UrlKeys } | null {
  const eligibility = checkEligibility(url);
  if (!eligibility.ok) return null;
  const keys = computeKeys(eligibility.url);
  return keys ? { url: eligibility.url, keys } : null;
}

function httpEnv(env: LookupEnv): HttpEnv {
  return { fetch: env.fetch, now: env.now, ...(env.sleep && { sleep: env.sleep }) };
}

/** What a discussion page (HN item, Reddit thread) resolved to. */
type Resolution =
  /**
   * Not a discussion page, or one that could not be resolved. When resolving failed, `failed` is
   * that source's state: the thread's own URL is no answer for it.
   */
  | { kind: 'none'; failed?: { source: SourceId; state: SourceState } }
  | {
      kind: 'link';
      from: { source: SourceId; id: string };
      url: string;
      keys: UrlKeys;
      hnSeed?: AlgoliaHit;
      redditSeed?: RedditPost;
    }
  /** Nothing to look up: a text post, or (`linkPost`) a link post whose link can't be looked up. */
  | { kind: 'text'; source: SourceId; id: string; thread?: Discussion; linkPost?: true };

/**
 * Looks up discussions of `url` on the enabled sources, and for `full` lookups also mentions of it.
 * Rejects only when `url` is not eligible or `opts.signal` aborts; every other failure becomes that
 * source's state (or its mentions' state).
 */
export async function lookup(
  url: string,
  opts: LookupOptions,
  env: LookupEnv,
): Promise<LookupResult> {
  const tab = eligiblePage(url);
  if (!tab) throw new Error(`Not a checkable URL: ${url}`);
  const key = `${RULES_VERSION}:${tab.keys.exact}`;
  const http = httpEnv(env);
  const { guard } = env;
  const { depth, signal } = opts;
  const force = opts.force ?? false;
  const hnCtx: HnContext = { depth, signal, env: http };
  const redditCtx: RedditContext = { depth, force, signal, env: http, guard };
  const previous = opts.previous?.key === key ? opts.previous : undefined;
  const redditAllowed = opts.sources.reddit && !opts.incognito;

  let page: PageInfo = { url: tab.url, display: displayUrl(tab.keys) };
  const sources: Record<SourceId, SourceState> = {
    hn: opts.sources.hn ? { status: 'loading' } : { status: 'off' },
    reddit: !opts.sources.reddit
      ? { status: 'off' }
      : opts.incognito
        ? { status: 'skipped', reason: 'incognito' }
        : { status: 'loading' },
  };
  // Only `full` lookups search for mentions, and only on the sources about to be asked.
  const mentions: Partial<Record<SourceId, MentionState>> = {};
  if (depth === 'full') {
    for (const id of SOURCE_IDS) {
      if (sources[id].status === 'loading') mentions[id] = { status: 'loading' };
    }
  }
  const dropMentions = () => {
    for (const id of SOURCE_IDS) delete mentions[id];
  };
  // Lowered when Reddit could not continue an `auto` result, so a later `full` lookup runs again.
  let reached = depth;
  // When the data reused from an earlier result was fetched.
  let reusedAt: number | undefined;
  const snapshot = (): LookupResult => {
    const now = env.now();
    return {
      key,
      page,
      sources: { ...sources },
      depth: reached,
      updatedAt: now,
      fetchedAt: reusedAt ?? now,
      ...(Object.keys(mentions).length > 0 && { mentions: { ...mentions } }),
    };
  };
  const emit = () => opts.onProgress?.(snapshot());
  emit();

  // 1. Discussion pages resolve to the URL they link to.
  let resolution: Resolution;
  try {
    resolution = await resolvePage(tab.keys, previous, {
      hn: opts.sources.hn,
      reddit: redditAllowed,
      resolveHn: (id) => resolveHnItem(id, hnCtx),
      resolveReddit: (id) => resolveRedditThread(id, redditCtx),
    });
  } catch {
    signal.throwIfAborted();
    // Like a provider failure, a resolution bug (or a failing KV store) must not fail the lookup:
    // the page is looked up as it is.
    resolution = { kind: 'none' };
  }
  signal.throwIfAborted();
  // A thread that could not be resolved also tells why its source can't be asked right now.
  if (resolution.kind === 'none' && resolution.failed) {
    sources[resolution.failed.source] = resolution.failed.state;
    delete mentions[resolution.failed.source];
  }

  if (resolution.kind === 'text') {
    page = {
      ...page,
      noLink: {
        source: resolution.source,
        id: resolution.id,
        ...(resolution.linkPost && { linkPost: true }),
      },
    };
    dropMentions();
    for (const id of SOURCE_IDS) {
      if (sources[id].status !== 'loading') continue;
      const items = id === resolution.source && resolution.thread ? [resolution.thread] : [];
      sources[id] = { status: 'ok', items, complete: true };
    }
    emit();
    return snapshot();
  }

  let target = tab;
  if (resolution.kind === 'link') {
    target = { url: resolution.url, keys: resolution.keys };
    page = {
      url: resolution.url,
      display: displayUrl(resolution.keys),
      resolvedFrom: { ...resolution.from, url: tab.url },
    };
    // Not a settled answer (the cache never serves `skipped` in a normal window), so a manual lookup
    // of the same thread still asks both sources.
    if (opts.isBlocked?.(resolution.url) === true) {
      for (const id of SOURCE_IDS) {
        if (sources[id].status === 'loading')
          sources[id] = { status: 'skipped', reason: 'filtered' };
      }
      dropMentions();
      emit();
      return snapshot();
    }
    emit();
  }

  // 2. Providers, in parallel. An earlier result for the same page is reused where it suffices.
  const earlier = previous?.page.url === target.url ? previous : undefined;
  // Mentions found earlier are reused at any depth; failed ones are asked again.
  for (const id of SOURCE_IDS) {
    const before = earlier?.mentions?.[id];
    if (earlier !== undefined && sources[id].status === 'loading' && before?.status === 'ok') {
      mentions[id] = before;
      reusedAt = earlier.fetchedAt;
    }
  }
  const reuse = (id: SourceId): { final?: OkState; partial?: OkState } => {
    const state = earlier?.sources[id];
    if (earlier === undefined || state?.status !== 'ok') return {};
    // Reused data (a continuation carries the earlier items too) keeps its age.
    reusedAt = earlier.fetchedAt;
    return earlier.depth === 'full' || depth === 'auto' ? { final: state } : { partial: state };
  };

  const run = async (id: SourceId, task: () => Promise<SourceState>): Promise<void> => {
    let state: SourceState;
    try {
      state = await task();
    } catch (error) {
      signal.throwIfAborted();
      // A bug in one provider must not take the other one down.
      state = { status: 'error', kind: 'format', detail: errorMessage(error) };
    }
    sources[id] = state;
    emit();
  };

  // Reddit's plan answered `ok`, but a request in it failed and ended it.
  let redditStopped = false;

  /**
   * A source's mention search, once its discussions have answered, and only when they answered `ok`.
   * The Reddit search is also skipped when a request in Reddit's plan failed (`redditStopped`), and
   * is held back by the rate guard while the account is challenged or low on requests.
   */
  const withMentions = async (
    id: SourceId,
    discussions: Promise<void>,
    find: () => Promise<MentionState>,
  ): Promise<void> => {
    await discussions;
    // Not wanted (an `auto` lookup), or reused.
    if (mentions[id]?.status !== 'loading') return;
    if (sources[id].status !== 'ok') {
      delete mentions[id];
      emit();
      return;
    }
    let state: MentionState;
    try {
      state = await find();
    } catch {
      signal.throwIfAborted();
      // A bug in a mention search must not fail the lookup.
      state = { status: 'failed' };
    }
    mentions[id] = state;
    emit();
  };

  const tasks: Array<Promise<void>> = [];
  if (sources.hn.status === 'loading') {
    const { final, partial } = reuse('hn');
    const seed = resolution.kind === 'link' ? resolution.hnSeed : undefined;
    const discussions = run('hn', () =>
      final
        ? Promise.resolve(final)
        : lookupHn(target.keys, {
            ...hnCtx,
            ...(partial && { previous: partial }),
            ...(seed && { seed: [seed] }),
          }),
    );
    tasks.push(withMentions('hn', discussions, () => lookupHnMentions(target.keys, hnCtx)));
  }
  if (sources.reddit.status === 'loading') {
    const { final, partial } = reuse('reddit');
    const seed = resolution.kind === 'link' ? resolution.redditSeed : undefined;
    const threadId =
      resolution.kind === 'link' && resolution.from.source === 'reddit'
        ? resolution.from.id
        : undefined;
    const discussions = run('reddit', async () => {
      if (final) return final;
      const { state, held, stopped } = await lookupReddit(target.keys, target.url, {
        ...redditCtx,
        ...(partial && { previous: partial }),
        ...(seed && { seed: [seed] }),
        ...(threadId !== undefined && { threadId }),
      });
      if (held) reached = 'auto';
      if (stopped) redditStopped = true;
      return state;
    });
    tasks.push(
      withMentions('reddit', discussions, () =>
        lookupRedditMentions(target.keys, redditCtx, { stopped: redditStopped }),
      ),
    );
  }
  await Promise.all(tasks);
  signal.throwIfAborted();
  return snapshot();
}

interface ResolveDeps {
  /** Whether each source may be asked (enabled; Reddit also not in a private window). */
  hn: boolean;
  reddit: boolean;
  resolveHn: (id: string) => Promise<HnItem>;
  resolveReddit: (id: string) => Promise<RedditThread>;
}

/**
 * Resolves `news.ycombinator.com/item?id=` and Reddit thread pages, reusing an earlier result's
 * resolution when there is one. A page that can't be resolved is looked up as it is.
 */
async function resolvePage(
  keys: UrlKeys,
  previous: LookupResult | undefined,
  deps: ResolveDeps,
): Promise<Resolution> {
  const [kind, id] = splitIdentity(keys.identity);
  const source: SourceId | undefined =
    kind === 'hn' && deps.hn ? 'hn' : kind === 'reddit' && deps.reddit ? 'reddit' : undefined;
  if (!source) return { kind: 'none' };

  const earlier = reusedResolution(previous, source, id);
  if (earlier) return earlier;

  // A link to something that can't be checked (a private host) leaves only the thread itself.
  if (source === 'hn') {
    const item = await deps.resolveHn(id);
    switch (item.kind) {
      case 'unknown':
        return { kind: 'none' };
      case 'failed':
        return { kind: 'none', failed: { source, state: item.state } };
      case 'text':
        return { kind: 'text', source, id, thread: item.thread };
      case 'link':
        break;
    }
    const target = eligiblePage(item.url);
    if (!target) {
      return { kind: 'text', source, id, thread: hnDiscussion(item.hit, 'same'), linkPost: true };
    }
    return { kind: 'link', from: { source, id }, ...target, hnSeed: item.hit };
  }

  const thread = await deps.resolveReddit(id);
  switch (thread.kind) {
    case 'unknown':
      return { kind: 'none' };
    case 'failed':
      return { kind: 'none', failed: { source, state: thread.state } };
    case 'self':
      return {
        kind: 'text',
        source,
        id,
        ...(thread.thread && { thread: thread.thread }),
        ...(thread.linkPost && { linkPost: true }),
      };
    case 'link':
      break;
  }
  const target = eligiblePage(thread.url);
  if (!target) {
    return {
      kind: 'text',
      source,
      id,
      ...(thread.thread && { thread: thread.thread }),
      linkPost: true,
    };
  }
  return { kind: 'link', from: { source, id }, ...target, redditSeed: thread.post };
}

function reusedResolution(
  previous: LookupResult | undefined,
  source: SourceId,
  id: string,
): Resolution | undefined {
  if (!previous) return undefined;
  const { resolvedFrom, noLink } = previous.page;
  if (resolvedFrom?.source === source && resolvedFrom.id === id) {
    const keys = computeKeys(previous.page.url);
    return keys ? { kind: 'link', from: { source, id }, url: previous.page.url, keys } : undefined;
  }
  if (noLink?.source === source && noLink.id === id) {
    const state = previous.sources[source];
    if (state.status !== 'ok') return undefined;
    const thread = state.items.find((d) => d.id === id);
    return {
      kind: 'text',
      source,
      id,
      ...(thread && { thread }),
      ...(noLink.linkPost && { linkPost: true }),
    };
  }
  return undefined;
}

/** Whether Reddit accepts the user's session: true, false (signed out), null (can't tell). */
export function redditSignedIn(env: LookupEnv, signal: AbortSignal): Promise<boolean | null> {
  return checkSignedIn({ signal, env: httpEnv(env), guard: env.guard });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
