// The results area: the filter/sort bar and the list of discussions, with placeholder rows for
// sources still being checked, the zero-comment fold and the "Other versions" group.

import { useId } from 'preact/hooks';
import { authorLabel, threadUrl, venueLabel, type RedditHost } from '@/core/links';
import type { Discussion, DiscussionFlag, SourceId } from '@/core/types';
import type { RowStat, SortOrder } from '@/platform/settings';
import { cx } from '@/ui/cx';
import { ChevronIcon, SortIcon } from '@/ui/icons';
import { Segmented, type Segment } from '@/ui/Segmented';
import { SourceMark } from '@/ui/SourceMark';
import { fullDate, grouped, plural, shortAge, urlDifference } from './format';
import { SOURCE_SHORT, type Filter, type PopupModel } from './model';

/** Handles click and auxclick on a link (see links.ts for the rules). */
export type LinkHandler = (event: MouseEvent, url: string) => void;

const SORT_ORDERS: readonly SortOrder[] = ['points', 'comments', 'newest'];
const SORT_LABELS: Record<SortOrder, string> = {
  points: 'Most points',
  comments: 'Most comments',
  newest: 'Newest',
};

/** Reddit calls points upvotes, so say so when only Reddit is listed. */
const sortLabel = (order: SortOrder, filter: Filter) =>
  order === 'points' && filter === 'reddit' ? 'Most upvotes' : SORT_LABELS[order];

export function Toolbar({
  model,
  filter,
  onFilter,
  sort,
  onSort,
}: {
  model: PopupModel;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  sort: SortOrder;
  onSort: (sort: SortOrder) => void;
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
    { value: 'hn', label: <SourceLabel source="hn" />, count: count('hn') },
    { value: 'reddit', label: <SourceLabel source="reddit" />, count: count('reddit') },
  ];
  return (
    <div class="bar">
      {model.showFilter ? (
        <Segmented legend="Show" options={options} value={filter} onChange={onFilter} />
      ) : (
        <p class="bar-summary">{model.summary}</p>
      )}
      <label class="sort">
        <span class="visually-hidden">Sort</span>
        <SortIcon />
        <select
          value={sort}
          onChange={(event) => {
            const { value } = event.currentTarget;
            onSort(SORT_ORDERS.find((order) => order === value) ?? 'points');
          }}
        >
          {SORT_ORDERS.map((value) => (
            <option key={value} value={value}>
              {sortLabel(value, filter)}
            </option>
          ))}
        </select>
        <ChevronIcon open />
      </label>
    </div>
  );
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
  pageUrl,
}: ListProps) {
  const isCurrent = (d: Discussion) =>
    model.current?.source === d.source && model.current.id === d.id;
  const row = (d: Discussion, others = false) => (
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
                <ChevronIcon open={foldOpen} />+{model.folded.length} more with no comments
              </button>
            </li>
          )}
          {foldOpen && model.folded.map((d) => row(d))}
        </ul>
      )}
      {model.similar.length > 0 && (
        <section class="others" aria-label="Other versions">
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
  d: Discussion;
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

function Row({ d, host, stat, now, onLink, current, pageUrl }: RowProps) {
  const id = useId();
  const href = threadUrl(d, host);
  const other: RowStat = stat === 'comments' ? 'points' : 'comments';
  const [one, many] = statUnits(stat, d.source);
  const flags = FLAG_LABELS.filter(([flag]) => d.flags.includes(flag));
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
        onMouseEnter={(event) => showFullTitle(event.currentTarget, d.title)}
      >
        <span class="row-title" id={`${id}-title`}>
          {d.title}
          {current && (
            <>
              {' '}
              <span class="tag tag-current">This thread</span>
            </>
          )}
        </span>
        <span class="row-count" id={`${id}-count`}>
          <span class="row-n">{grouped(d[stat])}</span>{' '}
          <span class="row-unit">{d[stat] === 1 ? one : many}</span>
        </span>
        <span class="row-meta" id={`${id}-meta`}>
          <span class="row-venue">
            <SourceMark source={d.source} />
            <span class="row-venue-name">{venueLabel(d)}</span>
          </span>
          <span>{plural(d[other], ...statUnits(other, d.source))}</span>
          <time dateTime={new Date(d.createdAt).toISOString()} title={fullDate(d.createdAt)}>
            {shortAge(d.createdAt, now)}
          </time>
          {flags.length > 0 && (
            <span class="row-flags">
              {flags.map(([flag, label]) => (
                <span class="tag" key={flag}>
                  {label}
                </span>
              ))}
            </span>
          )}
          {author !== '' && <span class="row-author">{author}</span>}
        </span>
        {pageUrl !== undefined && <SubmittedUrl url={d.submittedUrl} page={pageUrl} />}
      </a>
    </li>
  );
}

/**
 * Gives a row the native tooltip with its full title, but only while the two-line clamp cuts the
 * title off; a title that fits needs no tooltip. Checked on hover, so it follows the current layout.
 */
function showFullTitle(link: HTMLAnchorElement, title: string): void {
  const text = link.querySelector('.row-title');
  if (text !== null && text.scrollHeight > text.clientHeight + 1) link.title = title;
  else link.removeAttribute('title');
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
