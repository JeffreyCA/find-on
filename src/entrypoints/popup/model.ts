// What the popup shows for a lookup result, as plain data: per-source state, the filtered and sorted
// rows, the zero-comment fold, "Other versions", status lines and the empty state. Pure, so it can be
// tested without a DOM.

import { hnSiteUrl, redditLoginUrl, redditOrigin, type RedditHost } from '@/core/links';
import {
  SOURCE_IDS,
  type Discussion,
  type LookupResult,
  type SourceId,
  type SourceState,
} from '@/core/types';
import type { SortOrder } from '@/platform/settings';

export const SOURCE_NAMES: Record<SourceId, string> = { hn: 'Hacker News', reddit: 'Reddit' };
export const SOURCE_SHORT: Record<SourceId, string> = { hn: 'HN', reddit: 'Reddit' };

export type Filter = 'all' | SourceId;

export interface ModelInput {
  /** Latest snapshot or final result; null before the first one arrives. */
  result: LookupResult | null;
  /** A lookup request is in flight. */
  busy: boolean;
  /** Enabled sources, used until the first snapshot says otherwise. */
  enabled: Record<SourceId, boolean>;
  incognito: boolean;
  filter: Filter;
  sort: SortOrder;
  redditHost: RedditHost;
}

export interface SourceView {
  id: SourceId;
  state: SourceState;
  /** Waiting for this source's answer. */
  pending: boolean;
  /** Has SAME/EXACT results, or may still get some. */
  participates: boolean;
  /** SAME and EXACT discussions. */
  count: number;
}

export type StatusAction =
  | { kind: 'link'; label: string; url: string }
  | { kind: 'retry'; label: string; force: boolean };

export interface StatusLine {
  source: SourceId;
  /** "band": a problem, shown above the results. "note": a footnote under them. */
  tone: 'band' | 'note';
  text: string;
  /** Rate limits: the action appears once this time has passed; until then the line counts down. */
  retryAt?: number;
  action?: StatusAction;
}

/** A line under the URL field about how the page was looked up. */
export type PageNote = { kind: 'linked-from'; url: string } | { kind: 'text-post' } | null;

export interface PopupModel {
  sources: Record<SourceId, SourceView>;
  /** Some source is still being checked. */
  pending: boolean;
  /** Show the All / HN / Reddit filter (both sources have results, or may still). */
  showFilter: boolean;
  /** The filter in effect (falls back to "all" when the chosen source has nothing). */
  filter: Filter;
  /** SAME and EXACT discussions on every source. */
  total: number;
  /** Replaces the filter when only one source has results, e.g. "11 on Hacker News". */
  summary: string | null;
  /** Show the main list. */
  showResults: boolean;
  /** Show the filter/sort bar above it (not for a text post's lone thread). */
  showBar: boolean;
  /** Visible SAME/EXACT rows, sorted. */
  main: Discussion[];
  /** Zero-comment rows hidden behind "+N more with no comments". */
  folded: Discussion[];
  /** SIMILAR rows ("Other versions"), sorted. */
  similar: Discussion[];
  /** Sources to show placeholder rows for. */
  skeletons: SourceId[];
  statuses: StatusLine[];
  /** Lead text of the empty state, or null when there is something (or nothing yet) to show. */
  empty: string | null;
  /** Offer the Submit actions: nothing at all was found and nothing is pending. */
  submit: SourceId[];
  /** The thread the user came from, marked in the list. */
  current: { source: SourceId; id: string } | null;
  note: PageNote;
  /** Polite screen reader summary of the current state. */
  announcement: string;
}

/** A fold shorter than this is not worth a line of its own. */
const MIN_FOLD = 2;

export function buildModel(input: ModelInput): PopupModel {
  const { result, busy } = input;
  const view = (id: SourceId): SourceView => {
    const reported = result?.sources[id] ?? initialState(id, input);
    // Still loading after the lookup ended: the request itself failed.
    const state: SourceState =
      !busy && reported.status === 'loading'
        ? { status: 'error', kind: 'network', detail: 'no answer' }
        : reported;
    const pending = busy && isWaiting(state);
    const items = state.status === 'ok' ? state.items : [];
    const count = items.filter((d) => d.tier !== 'similar').length;
    return { id, state, pending, participates: pending || count > 0, count };
  };
  const sources: Record<SourceId, SourceView> = { hn: view('hn'), reddit: view('reddit') };
  const views = SOURCE_IDS.map((id) => sources[id]);
  const pending = views.some((s) => s.pending);
  const participating = views.filter((s) => s.participates);
  const showFilter = participating.length === SOURCE_IDS.length;

  const chosen = input.filter === 'all' ? undefined : sources[input.filter];
  const filter: Filter =
    showFilter && chosen !== undefined && (chosen.pending || chosen.count > 0) ? chosen.id : 'all';

  const page = result?.page;
  const from = page?.resolvedFrom ?? page?.noLink;
  const current = from ? { source: from.source, id: from.id } : null;
  const note: PageNote = page?.noLink
    ? { kind: 'text-post' }
    : page?.resolvedFrom
      ? { kind: 'linked-from', url: page.resolvedFrom.url }
      : null;

  const all = views.flatMap((s) => (s.state.status === 'ok' ? s.state.items : []));
  const shown = sortDiscussions(
    filter === 'all' ? all : all.filter((d) => d.source === filter),
    input.sort,
  );
  const ranked = shown.filter((d) => d.tier !== 'similar');
  const similar = shown.filter((d) => d.tier === 'similar');
  const isCurrent = (d: Discussion) => current?.source === d.source && current.id === d.id;
  const folded = foldable(ranked, isCurrent);
  const main = folded.length > 0 ? ranked.filter((d) => !folded.includes(d)) : ranked;
  const skeletons = views
    .filter((s) => s.pending && (filter === 'all' || filter === s.id))
    .map((s) => s.id);

  const total = views.reduce((n, s) => n + s.count, 0);
  const totalSimilar = all.length - total;
  const answered = views.filter((s) => s.state.status === 'ok');
  let empty: string | null = null;
  if (views.every((s) => s.state.status === 'off')) empty = 'Both sources are off in settings.';
  else if (!pending && total === 0 && answered.length > 0) {
    const unanswered = views.find((s) => s.state.status !== 'ok' && s.state.status !== 'off');
    if (page?.noLink) empty = 'Nothing else to look up.';
    else if (totalSimilar > 0) empty = 'No discussions of this exact page.';
    else if (unanswered !== undefined && answered.length === 1 && answered[0] !== undefined) {
      empty = `No discussions on ${SOURCE_NAMES[answered[0].id]}.`;
    } else empty = 'No discussions found.';
  }
  const submit =
    empty !== null && totalSimilar === 0 && !page?.noLink
      ? views.filter((s) => s.state.status !== 'off').map((s) => s.id)
      : [];

  const summary = showFilter ? null : summarize(participating[0], views);

  const statuses = views.flatMap((s) => {
    const line = statusLine(s, { busy, redditHost: input.redditHost, pageUrl: page?.url });
    return line ? [line] : [];
  });

  return {
    sources,
    pending,
    showFilter,
    filter,
    total,
    summary,
    showResults: ranked.length > 0 || skeletons.length > 0,
    showBar: (ranked.length > 0 || skeletons.length > 0) && !page?.noLink,
    main,
    folded,
    similar,
    skeletons,
    statuses,
    empty,
    submit,
    current,
    note,
    announcement: announce(views, { empty, total, totalSimilar, statuses }),
  };
}

/** Source states before the first snapshot: what the background is about to report. */
function initialState(id: SourceId, input: ModelInput): SourceState {
  if (!input.enabled[id]) return { status: 'off' };
  if (id === 'reddit' && input.incognito) return { status: 'skipped', reason: 'incognito' };
  return { status: 'loading' };
}

/** States that the popup's own (full) lookup is about to replace. */
function isWaiting(state: SourceState): boolean {
  return state.status === 'loading' || state.status === 'deferred' || state.status === 'paused';
}

/**
 * Zero-comment rows to fold away. When nothing has comments, the first row stays visible so the list
 * never starts with the fold. The thread the user came from is never folded.
 */
function foldable(rows: Discussion[], keep: (d: Discussion) => boolean): Discussion[] {
  const zero = rows.filter((d) => d.comments === 0 && !keep(d));
  const candidates = rows.some((d) => !zero.includes(d)) ? zero : zero.slice(1);
  return candidates.length >= MIN_FOLD ? candidates : [];
}

/**
 * "11 on Hacker News", plus "none on Reddit" when Reddit answered with nothing at all (not even
 * other versions, which would show under the list).
 */
function summarize(single: SourceView | undefined, views: SourceView[]): string | null {
  if (single === undefined) return null;
  if (single.pending) return `Checking ${SOURCE_NAMES[single.id]}`;
  const text = `${single.count} on ${SOURCE_NAMES[single.id]}`;
  const other = views.find((s) => s.id !== single.id);
  if (other?.state.status !== 'ok' || other.state.items.length > 0) return text;
  return `${text}, none on ${SOURCE_NAMES[other.id]}`;
}

const ERROR_TEXT: Record<Extract<SourceState, { status: 'error' }>['kind'], string> = {
  network: "couldn't connect",
  http: 'server error',
  format: 'unexpected response',
};

function statusLine(
  s: SourceView,
  ctx: { busy: boolean; redditHost: RedditHost; pageUrl: string | undefined },
): StatusLine | null {
  const { id, state } = s;
  const band = (text: string, action?: StatusAction): StatusLine => ({
    source: id,
    tone: 'band',
    text,
    ...(action && { action }),
  });
  switch (state.status) {
    case 'off':
    case 'loading':
      return null;
    case 'deferred':
    case 'paused':
      // The popup's own lookup runs the source; this only shows if that lookup failed to start.
      return ctx.busy
        ? null
        : band('not checked', { kind: 'retry', label: 'Check now', force: true });
    case 'ok': {
      const from = id === 'hn' && !state.complete && ctx.pageUrl ? hnSiteUrl(ctx.pageUrl) : null;
      if (from === null) return null;
      return {
        source: id,
        tone: 'note',
        text: 'more results may exist',
        action: { kind: 'link', label: `All from ${from.site}`, url: from.url },
      };
    }
    case 'signed-out':
      return band('not signed in', {
        kind: 'link',
        label: 'Sign in',
        url: redditLoginUrl(ctx.redditHost),
      });
    case 'challenge':
      return band('verification needed', {
        kind: 'link',
        label: 'Open Reddit',
        url: `${redditOrigin(ctx.redditHost)}/`,
      });
    case 'rate-limited':
      return {
        ...band('rate limited', { kind: 'retry', label: 'Try again', force: true }),
        retryAt: state.retryAt,
      };
    case 'skipped':
      return band('not checked in private windows');
    case 'error':
      return band(ERROR_TEXT[state.kind], { kind: 'retry', label: 'Retry', force: false });
    default:
      return null;
  }
}

function announce(
  views: SourceView[],
  ctx: { empty: string | null; total: number; totalSimilar: number; statuses: StatusLine[] },
): string {
  const parts: string[] = [];
  const waiting = views.filter((s) => s.pending).map((s) => SOURCE_NAMES[s.id]);
  if (waiting.length > 0) parts.push(`Checking ${waiting.join(' and ')}`);
  else if (ctx.empty !== null) parts.push(ctx.empty.replace(/\.$/, ''));
  if (ctx.total > 0) parts.push(`${ctx.total} ${ctx.total === 1 ? 'discussion' : 'discussions'}`);
  if (ctx.totalSimilar > 0 && waiting.length === 0) {
    parts.push(`${ctx.totalSimilar} other ${ctx.totalSimilar === 1 ? 'version' : 'versions'}`);
  }
  for (const line of ctx.statuses) {
    if (line.tone === 'band') parts.push(`${SOURCE_NAMES[line.source]}: ${line.text}`);
  }
  return parts.join('. ');
}

/**
 * Sorts by tier (SAME and EXACT before SIMILAR), then by `order`, then by comments, points and
 * newest as tie-breakers. Returns a new array.
 */
function sortDiscussions(items: readonly Discussion[], order: SortOrder): Discussion[] {
  return items.toSorted((a, b) => {
    const byGroup = tierGroup(a) - tierGroup(b);
    if (byGroup !== 0) return byGroup;
    for (const k of SORT_KEYS[order]) {
      const diff = k(b) - k(a);
      if (diff !== 0) return diff;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const tierGroup = (d: Discussion) => (d.tier === 'similar' ? 1 : 0);

/** Descending sort keys per order, most significant first. */
const SORT_KEYS: Record<SortOrder, ReadonlyArray<(d: Discussion) => number>> = {
  comments: [(d) => d.comments, (d) => d.points, (d) => d.createdAt],
  points: [(d) => d.points, (d) => d.comments, (d) => d.createdAt],
  newest: [(d) => d.createdAt, (d) => d.comments, (d) => d.points],
};
