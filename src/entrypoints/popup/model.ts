// What the popup shows for a lookup result, as plain data: per-source state, the filtered and sorted
// rows (text posts included when the user lists them), the zero-comment fold, "Other versions",
// the threads that link to the page ("Mentioned in comments"), status lines and the empty state. Pure,
// so it can be tested without a DOM.

import { hnSiteUrl, redditLoginUrl, redditOrigin, type RedditHost } from '@/core/links';
import { commentSearchUrl } from '@/core/providers/reddit';
import type {
  Discussion,
  LookupResult,
  Mention,
  MentionPost,
  MentionState,
  SourceId,
  SourceState,
} from '@/core/types';
import { computeKeys } from '@/core/url';
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
  /** The order of the sources (tabs, status lines, placeholders, submit buttons). */
  order: readonly SourceId[];
  /**
   * List posts that link to the page in their text or title with the discussions ("Text posts"),
   * rather than in the group of threads that link to the page.
   */
  textPosts: boolean;
}

/** What a row's thread is, shown by the icon before its title. */
export type RowKind =
  /** A post submitted with the page's URL. */
  | 'link'
  /** A text post: one that links to the page in its text, or the text post the user is on. */
  | 'text'
  /** A post that links to the page in its title. */
  | 'title'
  /** A thread found through comments that link to the page ("Mentioned in comments"). */
  | 'comments';

/** A row of the main list: a discussion, or a text post listed with them. */
export type ListRow = Discussion & { kind: RowKind };

export interface SourceView {
  id: SourceId;
  state: SourceState;
  /** Waiting for this source's answer. */
  pending: boolean;
  /** Has SAME/EXACT results or threads that mention the page, or may still get some. */
  participates: boolean;
  /** SAME and EXACT rows, text posts included when they are listed. */
  count: number;
  /** Rows in any tier. */
  rows: number;
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
  /** The sources in the user's order. */
  order: readonly SourceId[];
  /** Some source is still being checked. */
  pending: boolean;
  /** Show the All / HN / Reddit filter (both sources have results, or may still). */
  showFilter: boolean;
  /** The filter in effect (falls back to "all" when the chosen source has nothing). */
  filter: Filter;
  /** SAME and EXACT discussions on every source. */
  total: number;
  /** Replaces the filter when only one source has results, e.g. "11 on HN". */
  summary: string | null;
  /** Show the main list. */
  showResults: boolean;
  /** Show the filter/sort bar above it (not for a text post's lone thread). */
  showBar: boolean;
  /** Visible SAME/EXACT rows, sorted. */
  main: ListRow[];
  /** Zero-comment rows hidden behind "+N more without comments". */
  folded: ListRow[];
  /** SIMILAR rows ("Other versions"), sorted. */
  similar: ListRow[];
  /**
   * Threads that link to the page ("Mentioned in comments"), minus the ones listed above, in the
   * popup's
   * sort. By points or comments, rows without numbers (found through comments) come after the rest;
   * Newest orders by the newest mention.
   */
  mentions: Mention[];
  /** A shown source has more mentions than were fetched: the count reads "N+". */
  moreMentions: boolean;
  /** The group's heading: where its threads link to the page. */
  mentionsLabel: string;
  /**
   * Reddit's own comment search for the page, which Find On can't search itself: a link at the end
   * of the results while Reddit is asked and shown. Null otherwise.
   */
  commentSearch: string | null;
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
  const page = result?.page;
  const from = page?.resolvedFrom ?? page?.noLink;
  const current = from ? { source: from.source, id: from.id } : null;

  const stateOf = (id: SourceId): SourceState => {
    const reported = result?.sources[id] ?? initialState(id, input);
    // Still loading after the lookup ended: the request itself failed.
    return !busy && reported.status === 'loading'
      ? { status: 'error', kind: 'network', detail: 'no answer' }
      : reported;
  };
  const states: Record<SourceId, SourceState> = { hn: stateOf('hn'), reddit: stateOf('reddit') };
  // The only text post among the discussions can be the one the user is on, with no link to look up.
  const kindOf = (d: Discussion): RowKind =>
    page?.noLink?.source === d.source && page.noLink.id === d.id && !page.noLink.linkPost
      ? 'text'
      : 'link';
  const discussions = input.order.flatMap((id): ListRow[] => {
    const state = states[id];
    // oxlint-disable-next-line oxc/no-map-spread -- the items belong to the result; never mutate them
    return state.status === 'ok' ? state.items.map((d) => ({ ...d, kind: kindOf(d) })) : [];
  });

  const found = input.order.flatMap((id) => {
    const state = result?.mentions?.[id];
    return state?.status === 'ok' ? [{ source: id, state }] : [];
  });
  // A thread listed as a discussion (in any tier), or the one the user is on, is not a mention.
  const listed = new Set(discussions.map(threadKey));
  if (current) listed.add(threadKey(current));
  const everyMention = sortMentions(
    found.flatMap(({ state }) => state.items).filter((m) => !listed.has(threadKey(m))),
    input.sort,
    input.order,
  );
  // Listed text posts join the discussions; only threads found through comments stay mentions.
  const posts = input.textPosts ? everyMention.filter(hasPost).map(postRow) : [];
  const grouped = input.textPosts ? everyMention.filter((m) => !hasPost(m)) : everyMention;

  const view = (id: SourceId): SourceView => {
    const state = states[id];
    const pending = busy && isWaiting(state);
    const items = [
      ...(state.status === 'ok' ? state.items : []),
      ...posts.filter((p) => p.source === id),
    ];
    const count = items.filter((d) => d.tier !== 'similar').length;
    // Threads in the mentions group make a source worth filtering to as well.
    const mentioned = grouped.some((m) => m.source === id);
    const participates = pending || count > 0 || mentioned;
    return { id, state, pending, participates, count, rows: items.length };
  };
  const sources: Record<SourceId, SourceView> = { hn: view('hn'), reddit: view('reddit') };
  const views = input.order.map((id) => sources[id]);
  const pending = views.some((s) => s.pending);
  const participating = views.filter((s) => s.participates);
  const showFilter = participating.length === views.length;

  const chosen = input.filter === 'all' ? undefined : sources[input.filter];
  const filter: Filter = showFilter && chosen?.participates === true ? chosen.id : 'all';

  const note: PageNote = page?.noLink
    ? page.noLink.linkPost
      ? null
      : { kind: 'text-post' }
    : page?.resolvedFrom
      ? { kind: 'linked-from', url: page.resolvedFrom.url }
      : null;

  const all: ListRow[] = [...discussions, ...posts];
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

  const shows = (id: SourceId) => filter === 'all' || filter === id;
  const mentions = grouped.filter((m) => shows(m.source));
  const moreMentions = found.some(({ source, state }) => shows(source) && !state.complete);
  const linkedInPosts = mentions.some(hasPost);
  const linkedInComments = mentions.some((m) => m.inComments > 0);
  const mentionsLabel =
    linkedInPosts && linkedInComments
      ? 'Mentioned in posts and comments'
      : linkedInPosts
        ? 'Mentioned in posts'
        : 'Mentioned in comments';

  // Not in a private window (where Reddit is skipped) or for a text post, which has nothing to look
  // up. It does not wait for Reddit's answer, so it never appears late under the results.
  const reddit = sources.reddit.state;
  const redditAsked =
    reddit.status !== 'off' && !(reddit.status === 'skipped' && reddit.reason === 'incognito');
  const searchKeys =
    page !== undefined && !page.noLink && redditAsked && shows('reddit')
      ? computeKeys(page.url)
      : null;
  const commentSearch = searchKeys ? commentSearchUrl(searchKeys) : null;

  const total = views.reduce((n, s) => n + s.count, 0);
  const totalSimilar = all.length - total;
  const answered = views.filter((s) => s.state.status === 'ok');
  let empty: string | null = null;
  if (views.every((s) => s.state.status === 'off')) empty = 'Both sources are off in settings';
  else if (!pending && total === 0 && answered.length > 0) {
    if (page?.noLink) empty = 'Nothing else to look up';
    else if (totalSimilar > 0) empty = 'No discussions of this exact page';
    // Names what was searched: the sources that answered.
    else empty = `No discussions on ${answered.map((s) => SOURCE_NAMES[s.id]).join(' or ')}`;
  }
  const submit =
    empty !== null && totalSimilar === 0 && !page?.noLink
      ? views.filter((s) => s.state.status !== 'off').map((s) => s.id)
      : [];

  const summary = showFilter ? null : summarize(participating[0], views);

  const statuses = views.flatMap((s) => {
    const lines = [
      statusLine(s, { busy, redditHost: input.redditHost, pageUrl: page?.url }),
      mentionLine(s, result?.mentions?.[s.id], busy),
    ];
    return lines.filter((line) => line !== null);
  });

  return {
    sources,
    order: input.order,
    pending,
    showFilter,
    filter,
    total,
    summary,
    showResults: ranked.length > 0 || skeletons.length > 0,
    // From every source, not the filtered list, so a filter never takes the bar (and itself) away.
    // Also with only unlisted text posts, so their toggle stays within reach.
    showBar: (total > 0 || pending || showFilter || everyMention.some(hasPost)) && !page?.noLink,
    main,
    folded,
    similar,
    mentions,
    moreMentions,
    mentionsLabel,
    commentSearch,
    skeletons,
    statuses,
    empty,
    submit,
    current,
    note,
    // Like the other counts it reads, the mentions it reads ignore the filter.
    announcement: announce(views, {
      empty,
      total,
      totalSimilar,
      mentions: grouped.length,
      moreMentions: found.some(({ state }) => !state.complete),
      statuses,
    }),
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
  return (
    state.status === 'loading' ||
    state.status === 'deferred' ||
    state.status === 'paused' ||
    // An automatic lookup's blocklist skip; the popup's lookup always asks.
    (state.status === 'skipped' && state.reason === 'filtered')
  );
}

/**
 * Zero-comment rows to fold away. When nothing has comments, the first row stays visible so the list
 * never starts with the fold. The thread the user came from is never folded.
 */
function foldable<T extends Discussion>(rows: T[], keep: (d: T) => boolean): T[] {
  const zero = rows.filter((d) => d.comments === 0 && !keep(d));
  const candidates = rows.some((d) => !zero.includes(d)) ? zero : zero.slice(1);
  return candidates.length >= MIN_FOLD ? candidates : [];
}

/**
 * "11 on HN", plus "none on Reddit" when Reddit answered with nothing at all (not even other
 * versions, which would show under the list). Nothing for a source with mentions only.
 */
function summarize(single: SourceView | undefined, views: SourceView[]): string | null {
  if (single === undefined) return null;
  if (single.pending) return `Checking ${SOURCE_NAMES[single.id]}`;
  if (single.count === 0) return null;
  const text = `${single.count} on ${SOURCE_SHORT[single.id]}`;
  const other = views.find((s) => s.id !== single.id);
  if (other?.state.status !== 'ok' || other.rows > 0) return text;
  return `${text}, none on ${SOURCE_SHORT[other.id]}`;
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
      return state.reason === 'incognito' ? band('not checked in private windows') : null;
    case 'error':
      return band(ERROR_TEXT[state.kind], { kind: 'retry', label: 'Retry', force: false });
    default:
      return null;
  }
}

/**
 * A note when a source answered but its mention search did not: it failed, was held back by the
 * Reddit rate guard (counting down to when Reddit can be asked again), or never answered before the
 * lookup ended. A failed source has a band of its own instead.
 */
function mentionLine(
  s: SourceView,
  state: MentionState | undefined,
  busy: boolean,
): StatusLine | null {
  if (busy || s.state.status !== 'ok' || state === undefined || state.status === 'ok') return null;
  const retryAt = state.status === 'failed' ? state.retryAt : undefined;
  return {
    source: s.id,
    tone: 'note',
    text: 'mentions not checked',
    ...(retryAt !== undefined && { retryAt }),
    action: { kind: 'retry', label: 'Retry', force: false },
  };
}

function announce(
  views: SourceView[],
  ctx: {
    empty: string | null;
    total: number;
    totalSimilar: number;
    mentions: number;
    moreMentions: boolean;
    statuses: StatusLine[];
  },
): string {
  const parts: string[] = [];
  const waiting = views.filter((s) => s.pending).map((s) => SOURCE_NAMES[s.id]);
  if (waiting.length > 0) parts.push(`Checking ${waiting.join(' and ')}`);
  else if (ctx.empty !== null) parts.push(ctx.empty.replace(/\.$/, ''));
  if (ctx.total > 0) parts.push(`${ctx.total} ${ctx.total === 1 ? 'discussion' : 'discussions'}`);
  if (ctx.totalSimilar > 0 && waiting.length === 0) {
    parts.push(`${ctx.totalSimilar} other ${ctx.totalSimilar === 1 ? 'version' : 'versions'}`);
  }
  if (ctx.mentions > 0 && waiting.length === 0) {
    const n = `${ctx.mentions}${ctx.moreMentions ? '+' : ''}`;
    parts.push(
      `Mentioned in ${n} ${ctx.mentions === 1 && !ctx.moreMentions ? 'thread' : 'threads'}`,
    );
  }
  for (const line of ctx.statuses) {
    if (line.tone === 'band') parts.push(`${SOURCE_NAMES[line.source]}: ${line.text}`);
  }
  return parts.join('. ');
}

const threadKey = (t: { source: SourceId; id: string }) => `${t.source}:${t.id}`;

/** A mention whose post itself links to the page: listed like a discussion, wherever it shows. */
export const hasPost = (m: Mention): m is Mention & { post: MentionPost } => m.post !== undefined;

/** A text post as a row of the main list. */
export function postRow(m: Mention & { post: MentionPost }): ListRow {
  const { post } = m;
  return {
    source: m.source,
    id: m.id,
    title: m.title,
    // Only "Other versions" rows show the submitted URL.
    submittedUrl: '',
    venue: m.venue,
    author: post.author,
    points: post.points,
    comments: post.comments,
    createdAt: post.createdAt,
    tier: 'exact',
    permalink: m.permalink,
    flags: m.flags,
    kind: post.link,
  };
}

/**
 * Sorts by tier (SAME and EXACT before SIMILAR), then by `order`, then by comments, points and
 * newest as tie-breakers. Returns a new array.
 */
function sortDiscussions<T extends Discussion>(items: readonly T[], order: SortOrder): T[] {
  return items.toSorted(
    (a, b) => tierGroup(a) - tierGroup(b) || byKeys(SORT_KEYS[order], a, b) || byId(a, b),
  );
}

/** Mentions by `order`, then in the sources' order. Returns a new array. */
function sortMentions(
  items: readonly Mention[],
  order: SortOrder,
  sources: readonly SourceId[],
): Mention[] {
  const rank = (id: SourceId) => sources.indexOf(id);
  return items.toSorted(
    (a, b) =>
      byKeys(MENTION_SORT_KEYS[order], a, b) || rank(a.source) - rank(b.source) || byId(a, b),
  );
}

/** Compares by each key in turn, larger values first. */
function byKeys<T>(keys: ReadonlyArray<(x: T) => number>, a: T, b: T): number {
  for (const k of keys) {
    const diff = k(b) - k(a);
    if (diff !== 0) return diff;
  }
  return 0;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const tierGroup = (d: Discussion) => (d.tier === 'similar' ? 1 : 0);

/** Descending sort keys per order, most significant first. */
const SORT_KEYS: Record<SortOrder, ReadonlyArray<(d: Discussion) => number>> = {
  comments: [(d) => d.comments, (d) => d.points, (d) => d.createdAt],
  points: [(d) => d.points, (d) => d.comments, (d) => d.createdAt],
  newest: [(d) => d.createdAt, (d) => d.comments, (d) => d.points],
};

/**
 * The same for mention rows, with `linkedAt` as the age. A missing number counts -1, so by points or
 * comments a row without numbers follows every row with them.
 */
const MENTION_SORT_KEYS: Record<SortOrder, ReadonlyArray<(m: Mention) => number>> = {
  comments: [(m) => m.post?.comments ?? -1, (m) => m.post?.points ?? -1, (m) => m.linkedAt],
  points: [(m) => m.post?.points ?? -1, (m) => m.post?.comments ?? -1, (m) => m.linkedAt],
  newest: [(m) => m.linkedAt, (m) => m.post?.comments ?? -1, (m) => m.post?.points ?? -1],
};
