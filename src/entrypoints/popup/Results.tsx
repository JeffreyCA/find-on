// The results area: the filter/sort bar (with the "Text posts" toggle) and the list of discussions,
// with placeholder rows for sources still being checked, the zero-comment fold, the "Other versions"
// and "Mentioned in comments" groups, and the "Search Reddit comments" link that ends the results.

import { useId } from 'preact/hooks';
import { authorLabel, mentionUrl, threadUrl, venueLabel, type RedditHost } from '@/core/links';
import type { Discussion, DiscussionFlag, Mention, SourceId } from '@/core/types';
import type { RowStat, SortOrder } from '@/platform/settings';
import { cx } from '@/ui/cx';
import {
  ChevronIcon,
  CommentIcon,
  ExternalIcon,
  LinkPostIcon,
  PointsIcon,
  SortIcon,
  TextPostIcon,
} from '@/ui/icons';
import { Segmented, type Segment } from '@/ui/Segmented';
import { SourceMark } from '@/ui/SourceMark';
import { fullDate, grouped, shortAge, urlDifference } from './format';
import { SOURCE_SHORT, type Filter, type ListRow, type PopupModel, type RowKind } from './model';

/** Handles click and auxclick on a link (see links.ts for the rules). */
export type LinkHandler = (event: MouseEvent, url: string) => void;

const SORT_ORDERS: readonly SortOrder[] = ['points', 'comments', 'newest'];
/** Short, so the bar holds the filter, the "Text posts" toggle and the sort in 400 px. */
const SORT_LABELS: Record<SortOrder, string> = {
  points: 'Points',
  comments: 'Comments',
  newest: 'Newest',
};

export function Toolbar({
  model,
  filter,
  onFilter,
  sort,
  onSort,
  onOrder,
  textPosts,
  onTextPosts,
}: {
  model: PopupModel;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  sort: SortOrder;
  onSort: (sort: SortOrder) => void;
  /** The sources reordered by dragging their tabs. */
  onOrder: (order: SourceId[]) => void;
  /** Text posts are listed with the discussions. */
  textPosts: boolean;
  onTextPosts: (on: boolean) => void;
}) {
  const count = (id: SourceId) =>
    model.sources[id].pending ? <Pending /> : String(model.sources[id].count);
  const options: Array<Segment<Filter>> = [
    // "All 0" would read as a result while nothing has answered yet.
    {
      value: 'all',
      label: 'All',
      count: model.pending && model.total === 0 ? <Pending /> : String(model.total),
    },
    ...model.order.map((id) => ({
      value: id,
      label: <SourceLabel source={id} />,
      count: count(id),
      movable: true,
    })),
  ];
  return (
    <div class="bar">
      {model.showFilter ? (
        <Segmented
          legend="Show"
          options={options}
          value={filter}
          onChange={onFilter}
          onReorder={(moved, target) => {
            if (moved !== 'all' && target !== 'all') onOrder(reorder(model.order, moved, target));
          }}
        />
      ) : (
        <p class="bar-summary">{model.summary}</p>
      )}
      <button
        type="button"
        class="chip"
        aria-pressed={textPosts}
        title="Posts that link to the page in their text or title"
        onClick={() => onTextPosts(!textPosts)}
      >
        <TextPostIcon />
        Text posts
      </button>
      <label class="sort">
        <span class="visually-hidden">Sort</span>
        <SortIcon />
        <span class="sort-value" aria-hidden="true">
          {SORT_LABELS[sort]}
        </span>
        <ChevronIcon open />
        <select
          value={sort}
          onChange={(event) => {
            const { value } = event.currentTarget;
            onSort(SORT_ORDERS.find((order) => order === value) ?? 'points');
          }}
        >
          {SORT_ORDERS.map((value) => (
            <option key={value} value={value}>
              {SORT_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** `order` with `moved` taken out and put back where `target` was. */
function reorder(order: readonly SourceId[], moved: SourceId, target: SourceId): SourceId[] {
  const next = order.filter((id) => id !== moved);
  next.splice(order.indexOf(target), 0, moved);
  return next;
}

/** A filter label: the source's mark and short name. */
function SourceLabel({ source }: { source: SourceId }) {
  return (
    <>
      <SourceMark source={source} />
      {SOURCE_SHORT[source]}
    </>
  );
}

/** Three quiet dots in place of a count that is still coming. */
function Pending() {
  return (
    <>
      <span class="pending-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span class="visually-hidden">checking</span>
    </>
  );
}

interface ListProps {
  model: PopupModel;
  host: RedditHost;
  rowStat: RowStat;
  now: number;
  onLink: LinkHandler;
  foldOpen: boolean;
  onFold: () => void;
  othersOpen: boolean;
  onOthers: () => void;
  mentionsOpen: boolean;
  onMentions: () => void;
  pageUrl: string;
}

export function ResultList({
  model,
  host,
  rowStat,
  now,
  onLink,
  foldOpen,
  onFold,
  othersOpen,
  onOthers,
  mentionsOpen,
  onMentions,
  pageUrl,
}: ListProps) {
  const isCurrent = (d: Discussion) =>
    model.current?.source === d.source && model.current.id === d.id;
  const row = (d: ListRow, others = false) => (
    <Row
      key={`${d.source}:${d.id}`}
      d={d}
      host={host}
      stat={rowStat}
      now={now}
      onLink={onLink}
      current={isCurrent(d)}
      {...(others && { pageUrl })}
    />
  );
  return (
    <>
      {model.showResults && (
        <ul class="list" aria-label="Discussions">
          {model.main.map((d) => row(d))}
          {model.skeletons.flatMap((source) =>
            [0, 1, 2]
              .slice(0, model.main.length > 0 ? 2 : 3)
              .map((i) => <SkeletonRow key={`${source}-${i}`} source={source} index={i} />),
          )}
          {model.folded.length > 0 && (
            <li class="fold">
              <button
                type="button"
                class="disclosure"
                aria-expanded={foldOpen}
                data-nav
                onClick={onFold}
              >
                <ChevronIcon open={foldOpen} />+{model.folded.length} more without comments
              </button>
            </li>
          )}
          {foldOpen && model.folded.map((d) => row(d))}
        </ul>
      )}
      {model.similar.length > 0 && (
        <section class="others versions" aria-label="Other versions">
          <button
            type="button"
            class="disclosure others-head"
            aria-expanded={othersOpen}
            data-nav
            onClick={onOthers}
          >
            <ChevronIcon open={othersOpen} />
            Other versions <span class="disclosure-count">{model.similar.length}</span>
          </button>
          {othersOpen && <ul class="list">{model.similar.map((d) => row(d, true))}</ul>}
        </section>
      )}
      {model.mentions.length > 0 && (
        <section class="others mentions" aria-label="Mentioned in comments">
          <button
            type="button"
            class="disclosure others-head"
            aria-expanded={mentionsOpen}
            data-nav
            onClick={onMentions}
          >
            <ChevronIcon open={mentionsOpen} />
            Mentioned in comments{' '}
            <span class="disclosure-count">
              {model.mentions.length}
              {model.moreMentions && '+'}
            </span>
          </button>
          {mentionsOpen && (
            <ul class="list">
              {model.mentions.map((m) => (
                <MentionRow
                  key={`${m.source}:${m.id}`}
                  m={m}
                  host={host}
                  now={now}
                  onLink={onLink}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

/**
 * Flags shown on a row, in this order. "Archived" is left out: Reddit archives posts after six
 * months, so it would tag most older rows while saying no more than their age does.
 */
const FLAG_LABELS: ReadonlyArray<[DiscussionFlag, string]> = [
  ['nsfw', 'NSFW'],
  ['spoiler', 'Spoiler'],
  ['locked', 'Locked'],
];

interface RowProps {
  d: ListRow;
  host: RedditHost;
  /** The number set large on the right; the other one goes in the meta line. */
  stat: RowStat;
  now: number;
  onLink: LinkHandler;
  /** The thread the user came from. */
  current: boolean;
  /** For "Other versions": the looked-up page, to show how the submitted URL differs. */
  pageUrl?: string;
}

/** Singular and plural unit for a stat; Reddit calls points upvotes. */
function statUnits(stat: RowStat, source: SourceId): [one: string, many: string] {
  if (stat === 'comments') return ['comment', 'comments'];
  return source === 'reddit' ? ['upvote', 'upvotes'] : ['point', 'points'];
}

/** What the icon before a row's title stands for: its tooltip, and what screen readers hear. */
const KIND_LABELS: Record<RowKind, string> = {
  link: 'Link post',
  text: 'Text post',
  title: 'Link in post title',
  comments: 'Mentioned in comments',
};

function Row({ d, host, stat, now, onLink, current, pageUrl }: RowProps) {
  const id = useId();
  const href = threadUrl(d, host);
  const other: RowStat = stat === 'comments' ? 'points' : 'comments';
  const author = authorLabel(d);
  return (
    <li class={cx('row', current && 'is-current')} data-key={`${d.source}:${d.id}`}>
      <a
        class="row-link"
        href={href}
        data-nav
        aria-labelledby={`${id}-title ${id}-count`}
        aria-describedby={`${id}-meta`}
        onClick={(event) => onLink(event, href)}
        onAuxClick={(event) => onLink(event, href)}
        title={d.title}
      >
        <span class="row-title" id={`${id}-title`}>
          <KindIcon kind={d.kind} />
          {d.title}
          {current && (
            <>
              {' '}
              <span class="tag tag-current">This thread</span>
            </>
          )}
        </span>
        <RowCount id={id} n={d[stat]} stat={stat} source={d.source} />
        <span class="row-meta" id={`${id}-meta`}>
          <RowVenue of={d} />
          <MetaStat n={d[other]} stat={other} source={d.source} />
          <RowAge at={d.createdAt} now={now} />
          <RowFlags flags={d.flags} />
          {author !== '' && <span class="row-author">{author}</span>}
          <KindText kind={d.kind} />
        </span>
        {pageUrl !== undefined && <SubmittedUrl url={d.submittedUrl} page={pageUrl} />}
      </a>
    </li>
  );
}

/** Reddit's own comment search for the page, which Find On can't search itself. */
export function CommentSearch({ url, onLink }: { url: string; onLink: LinkHandler }) {
  return (
    <p class="comment-search">
      <a
        class="disclosure comment-search-link"
        href={url}
        data-nav
        onClick={(event) => onLink(event, url)}
        onAuxClick={(event) => onLink(event, url)}
      >
        <SourceMark source="reddit" />
        Search Reddit comments
        <ExternalIcon />
      </a>
    </p>
  );
}

/**
 * A thread found through comments that link to the page: its title, then where it is, how many of
 * its comments link to the page (only when several do; the heading already says one does), and when
 * the newest one was written. HN's comment search returns no numbers for the thread itself, so there
 * is no count on the right.
 */
function MentionRow({
  m,
  host,
  now,
  onLink,
}: {
  m: Mention;
  host: RedditHost;
  now: number;
  onLink: LinkHandler;
}) {
  const id = useId();
  const href = mentionUrl(m, host);
  return (
    <li class="row" data-key={`mention:${m.source}:${m.id}`}>
      <a
        class="row-link no-count"
        href={href}
        data-nav
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-meta`}
        onClick={(event) => onLink(event, href)}
        onAuxClick={(event) => onLink(event, href)}
        title={m.title}
      >
        <span class="row-title" id={`${id}-title`}>
          <KindIcon kind="comments" />
          {m.title}
        </span>
        <span class="row-meta" id={`${id}-meta`}>
          <RowVenue of={m} />
          {m.inComments > 1 && <span>in {m.inComments} comments</span>}
          <RowAge at={m.linkedAt} now={now} />
          <RowFlags flags={m.flags} />
        </span>
      </a>
    </li>
  );
}

/**
 * What the thread is, as an icon before its title, with its meaning as a tooltip. It stays out of
 * the row's name: screen readers get the meaning from KindText in the discussion rows, and from the
 * group's name ("Mentioned in comments") in the rows of threads found through comments.
 */
function KindIcon({ kind }: { kind: RowKind }) {
  return (
    <span class="row-kind" title={KIND_LABELS[kind]} aria-hidden="true">
      {kind === 'link' ? (
        <LinkPostIcon />
      ) : kind === 'comments' ? (
        <CommentIcon />
      ) : (
        <TextPostIcon />
      )}
    </span>
  );
}

/** The meaning of the row's icon for screen readers, last in its description; link posts say nothing. */
function KindText({ kind }: { kind: RowKind }) {
  return kind === 'link' ? null : <span class="visually-hidden">{KIND_LABELS[kind]}</span>;
}

function StatIcon({ stat }: { stat: RowStat }) {
  return stat === 'comments' ? <CommentIcon /> : <PointsIcon />;
}

/** The other number, in the meta line: its icon and the number; the unit is only read out. */
function MetaStat({ n, stat, source }: { n: number; stat: RowStat; source: SourceId }) {
  const [one, many] = statUnits(stat, source);
  return (
    <span class="row-stat">
      <StatIcon stat={stat} />
      {grouped(n)}
      <span class="visually-hidden">{` ${n === 1 ? one : many}`}</span>
    </span>
  );
}

/** The number set large on the right of a row, after its icon; the unit is only read out. */
function RowCount({
  id,
  n,
  stat,
  source,
}: {
  id: string;
  n: number;
  stat: RowStat;
  source: SourceId;
}) {
  const [one, many] = statUnits(stat, source);
  return (
    <span class="row-count" id={`${id}-count`}>
      <StatIcon stat={stat} />
      <span class="row-n">{grouped(n)}</span>
      <span class="visually-hidden">{` ${n === 1 ? one : many}`}</span>
    </span>
  );
}

function RowVenue({ of }: { of: Pick<Discussion, 'source' | 'venue'> }) {
  return (
    <span class="row-venue">
      <SourceMark source={of.source} />
      <span class="row-venue-name">{venueLabel(of)}</span>
    </span>
  );
}

function RowAge({ at, now }: { at: number; now: number }) {
  return (
    <time dateTime={new Date(at).toISOString()} title={fullDate(at)}>
      {shortAge(at, now)}
    </time>
  );
}

function RowFlags({ flags }: { flags: readonly DiscussionFlag[] }) {
  const shown = FLAG_LABELS.filter(([flag]) => flags.includes(flag));
  if (shown.length === 0) return null;
  return (
    <span class="row-flags">
      {shown.map(([flag, label]) => (
        <span class="tag" key={flag}>
          {label}
        </span>
      ))}
    </span>
  );
}

/** The submitted URL, with the parts that differ from the looked-up page set darker. */
function SubmittedUrl({ url, page }: { url: string; page: string }) {
  return (
    <span class="row-url">
      {urlDifference(url, page).map(({ text, start, diff }) =>
        diff ? <b key={start}>{text}</b> : text,
      )}
    </span>
  );
}

const SKELETON_WIDTHS = ['72%', '58%', '66%'];

/** A placeholder row while a source is being checked; its meta line names the source. */
function SkeletonRow({ source, index }: { source: SourceId; index: number }) {
  return (
    <li class="row is-skeleton" aria-hidden="true">
      <span class="row-link">
        <span class="row-title">
          <span class="sk" style={{ width: SKELETON_WIDTHS[index % SKELETON_WIDTHS.length] }} />
        </span>
        <span class="row-count">
          <span class="sk sk-count" />
        </span>
        <span class="row-meta">
          <span class="row-venue">
            <SourceMark source={source} />
            <span class="row-venue-name">{source === 'hn' ? 'HN' : 'r/'}</span>
          </span>
          <span class="sk sk-meta" />
        </span>
      </span>
    </li>
  );
}
