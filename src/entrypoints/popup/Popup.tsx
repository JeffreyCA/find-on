// The popup's view. Everything it shows comes from props, so each state can be rendered in tests;
// App.tsx connects it to the browser.

import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RedditHost } from '@/core/links';
import type { LookupResult, SourceId } from '@/core/types';
import type { Settings, SortOrder } from '@/platform/settings';
import { Button, LinkButton } from '@/ui/Button';
import { cx } from '@/ui/cx';
import { disclosure } from '@/ui/disclosure';
import { useNow } from '@/ui/hooks';
import { RecheckIcon, SettingsIcon } from '@/ui/icons';
import { SourceMark } from '@/ui/SourceMark';
import { StatusText } from '@/ui/StatusText';
import { countdown, readableUrl, submitUrls } from './format';
import { buildModel, SOURCE_NAMES, type Filter, type PopupModel, type StatusLine } from './model';
import { ResultList, SourceLinks, Toolbar, type LinkHandler } from './Results';
import type { Target } from './target';

/** How many rows of a group opening it brings into view. */
const REVEAL_ROWS = 2;

export interface PopupActions {
  /** Looks up what was typed into the URL field. */
  check: (input: string) => void;
  /** Looks the page up again; `force` bypasses the cache and the Reddit rate guard. */
  recheck: (force: boolean) => void;
  setSort: (sort: SortOrder) => void;
  setOrder: (order: SourceId[]) => void;
  setTextPosts: (on: boolean) => void;
  /** Remembers whether the mentions group was left open, for the next popup. */
  setMentionsOpen: (open: boolean) => void;
  openLink: LinkHandler;
  openSettings: () => void;
  /** Opens the page that explains what is sent where. */
  openDetails: () => void;
  /** The first-use choice: saves how pages are checked, which also confirms onboarding. */
  chooseMode: (autoCheck: boolean) => void;
  close: () => void;
}

export interface PopupProps {
  target: Target;
  result: LookupResult | null;
  busy: boolean;
  incognito: boolean;
  settings: Settings;
  onboarded: boolean;
  sort: SortOrder;
  /** The sources in the user's order. */
  order: SourceId[];
  /** Whether the mentions group was left open last time; null until it was first toggled. */
  mentionsOpen: boolean | null;
  /** Updated since settings was last opened: the settings button carries a dot. */
  whatsNew: boolean;
  actions: PopupActions;
}

export function Popup({
  target,
  result,
  busy,
  incognito,
  settings,
  onboarded,
  sort,
  order,
  mentionsOpen: mentionsLeftOpen,
  whatsNew,
  actions,
}: PopupProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [foldOpen, setFoldOpen] = useState(false);
  const [othersOpen, setOthersOpen] = useState<boolean | null>(null);
  const [mentionsOpen, setMentionsOpen] = useState<boolean | null>(null);
  // The first-use choice made in this popup, confirmed in place of the question until it closes.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const recheckRef = useRef<HTMLButtonElement>(null);

  const model = buildModel({
    result,
    busy,
    enabled: settings.sources,
    incognito,
    filter,
    sort,
    redditHost: settings.redditHost,
    order,
    textPosts: settings.textPosts,
  });
  // Rate-limit lines count down to their retry time.
  const ticking = model.statuses.some((s) => s.retryAt !== undefined);
  const now = useNow(1000, ticking);

  // A new page starts with the filter and groups reset.
  const pageKey = target.kind === 'page' ? target.url : `unchecked:${target.address}`;
  useEffect(() => {
    setFilter('all');
    setFoldOpen(false);
    setOthersOpen(null);
    setMentionsOpen(null);
  }, [pageKey]);

  useKeyboard(rootRef, fieldRef, actions.close);
  useStableFocus(rootRef, model);
  // The first-use card leaves once a choice is made, taking the focused button with it. Keep the
  // keyboard in the popup: on the first result, or on the URL field when there is none.
  useEffect(() => {
    if (chosen === null) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    (rootRef.current?.querySelector<HTMLElement>('[data-nav]') ?? fieldRef.current)?.focus();
  }, [chosen]);

  const pageUrl = result?.page.url ?? (target.kind === 'page' ? target.url : '');
  // A status line's button leaves with its line once the source is checked again: keep the keyboard
  // on "Check again", which stays.
  const retry = (force: boolean) => {
    recheckRef.current?.focus();
    actions.recheck(force);
  };
  // A group opens by itself when the list above it is empty (no discussions, or none for the chosen
  // source), so what was found is never hidden behind a closed heading. Otherwise "Other versions"
  // starts closed, and "Mentioned in HN comments" as the user last left it.
  const listEmpty = !model.showResults;
  const notes = model.statuses.filter((s) => s.tone === 'note');
  const othersShown = othersOpen ?? (listEmpty && model.similar.length > 0);
  const mentionsShown =
    mentionsOpen ?? ((listEmpty && model.mentions.length > 0) || (mentionsLeftOpen ?? false));
  // Opening a group at the end of the list brings its first rows into view, scrolling no further
  // than that and never past the group's heading, so the rows above it stay in sight.
  const reveal = (selector: string) =>
    requestAnimationFrame(() => {
      const scroller = rootRef.current?.querySelector<HTMLElement>('.results');
      const group = scroller?.querySelector<HTMLElement>(selector);
      if (!scroller || !group) return;
      const rows = group.querySelectorAll<HTMLElement>('.row');
      const last = rows[Math.min(rows.length, REVEAL_ROWS) - 1] ?? group;
      const view = scroller.getBoundingClientRect();
      const below = last.getBoundingClientRect().bottom - view.bottom;
      const room = group.getBoundingClientRect().top - view.top;
      if (below > 0) scroller.scrollBy({ top: Math.min(below, room) });
    });

  return (
    <div class="popup" ref={rootRef}>
      <h1 class="visually-hidden">Find On</h1>
      <header class="top">
        <PageLine
          target={target}
          display={result?.page.display}
          busy={busy}
          model={model}
          fieldRef={fieldRef}
          recheckRef={recheckRef}
          whatsNew={whatsNew}
          actions={actions}
        />
        {chosen !== null ? (
          <p class="onboarding-done">
            <StatusText tone="ok" live>
              {chosen ? 'Lookup mode: automatic' : 'Lookup mode: manual'}
            </StatusText>
          </p>
        ) : (
          !onboarded && (
            <Onboarding
              autoCheck={settings.autoCheck}
              sources={settings.sources}
              onChoose={(autoCheck) => {
                setChosen(autoCheck);
                actions.chooseMode(autoCheck);
              }}
              onDetails={actions.openDetails}
            />
          )
        )}
        {target.kind === 'page' &&
          model.statuses
            .filter((s) => s.tone === 'band')
            .map((s) => (
              <Status
                key={`${s.source}:${s.text}`}
                line={s}
                now={now}
                busy={busy}
                onLink={actions.openLink}
                onRetry={retry}
              />
            ))}
        {target.kind === 'page' && model.showBar && (
          <Toolbar
            model={model}
            filter={model.filter}
            onFilter={setFilter}
            sort={sort}
            onSort={actions.setSort}
            onOrder={actions.setOrder}
            textPosts={settings.textPosts}
            onTextPosts={actions.setTextPosts}
          />
        )}
      </header>
      <main class="results">
        {target.kind === 'unchecked' ? (
          <div class="empty">
            <p class="empty-lead">
              {target.typed ? "This address can't be checked" : "This page can't be checked"}
            </p>
            {target.address !== '' && <p class="empty-address">{target.address}</p>}
          </div>
        ) : (
          <>
            {model.empty !== null && (
              <Empty
                text={model.empty}
                submit={model.submit}
                url={pageUrl}
                title={target.title}
                host={settings.redditHost}
                onLink={actions.openLink}
              />
            )}
            <ResultList
              model={model}
              host={settings.redditHost}
              rowStat={settings.rowStat}
              now={now}
              onLink={actions.openLink}
              foldOpen={foldOpen}
              onFold={() => setFoldOpen((open) => !open)}
              othersOpen={othersShown}
              onOthers={() => {
                setOthersOpen(!othersShown);
                if (!othersShown) reveal('.versions');
              }}
              mentionsOpen={mentionsShown}
              onMentions={() => {
                setMentionsOpen(!mentionsShown);
                actions.setMentionsOpen(!mentionsShown);
                if (!mentionsShown) reveal('.mentions');
              }}
              pageUrl={pageUrl}
            />
            {notes.length > 0 && (
              <div class="notes">
                {notes.map((s) => (
                  <Status
                    key={`${s.source}:${s.text}`}
                    line={s}
                    now={now}
                    busy={busy}
                    onLink={actions.openLink}
                    onRetry={retry}
                  />
                ))}
              </div>
            )}
            {model.links.length > 0 && (
              <SourceLinks links={model.links} onLink={actions.openLink} />
            )}
          </>
        )}
      </main>
      <p class="visually-hidden" aria-live="polite">
        {target.kind === 'page' ? model.announcement : ''}
      </p>
    </div>
  );
}

function PageLine({
  target,
  display,
  busy,
  model,
  fieldRef,
  recheckRef,
  whatsNew,
  actions,
}: {
  target: Target;
  display: string | undefined;
  busy: boolean;
  model: PopupModel;
  fieldRef: RefObject<HTMLInputElement | null>;
  recheckRef: RefObject<HTMLButtonElement | null>;
  whatsNew: boolean;
  actions: PopupActions;
}) {
  const shown =
    target.kind === 'page' ? (display ?? target.display) : target.typed ? target.address : '';
  const [draft, setDraft] = useState(shown);
  // The field follows the page (a new target, or a discussion page resolving) unless the user has
  // started editing it; submitting or reverting hands it back to the page.
  const editingRef = useRef(false);
  useEffect(() => {
    if (!editingRef.current) setDraft(shown);
  }, [shown]);
  // Nothing to show for a page that can't be checked: the field is the way forward.
  useEffect(() => {
    if (target.kind === 'unchecked') fieldRef.current?.focus();
  }, [target, fieldRef]);

  const note = model.note;
  return (
    <div class="pageline">
      <form
        class="pageline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim() === '') return;
          editingRef.current = false;
          actions.check(draft);
        }}
      >
        <input
          ref={fieldRef}
          class="pageline-field"
          type="text"
          inputMode="url"
          aria-label="Page address"
          placeholder="Enter an address to check"
          spellcheck={false}
          autocomplete="off"
          autocapitalize="off"
          value={draft}
          onInput={(event) => {
            editingRef.current = true;
            setDraft(event.currentTarget.value);
          }}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            // Escape first undoes an edit; with nothing to undo it closes the popup.
            if (event.key === 'Escape' && draft !== shown) {
              event.preventDefault();
              editingRef.current = false;
              setDraft(shown);
            }
          }}
        />
        <button
          ref={recheckRef}
          type="button"
          class={cx('icon-btn', busy && 'is-busy')}
          aria-label="Check again"
          title="Check again"
          disabled={target.kind !== 'page'}
          aria-disabled={busy}
          onClick={() => {
            if (!busy) actions.recheck(true);
          }}
        >
          <RecheckIcon />
        </button>
        <button
          type="button"
          class={cx('icon-btn', whatsNew && 'has-dot')}
          aria-label={whatsNew ? "Settings, what's new" : 'Settings'}
          title={whatsNew ? "Settings: what's new" : 'Settings'}
          onClick={actions.openSettings}
        >
          <SettingsIcon />
        </button>
      </form>
      {note?.kind === 'linked-from' && (
        <p class="pageline-note">
          Linked from <span class="pageline-from">{readableUrl(note.url)}</span>
        </p>
      )}
      {note?.kind === 'text-post' && <p class="pageline-note">Text post with no link</p>}
    </div>
  );
}

/**
 * First use: what is sent where, and the two ways to check pages. Either button is the whole
 * confirmation; the one matching the stored setting (automatic by default) is the primary one.
 */
function Onboarding({
  autoCheck,
  sources,
  onChoose,
  onDetails,
}: {
  autoCheck: boolean;
  sources: Settings['sources'];
  onChoose: (autoCheck: boolean) => void;
  onDetails: () => void;
}) {
  const sends = disclosure(sources);
  return (
    <section class="onboarding" aria-label="Lookup mode">
      <p class="onboarding-text">
        {sends !== null && `${sends} `}
        <Button variant="text" onClick={onDetails}>
          Details
        </Button>
      </p>
      <div class="onboarding-choices">
        <Button variant={autoCheck ? 'primary' : 'default'} onClick={() => onChoose(true)}>
          Automatic lookup
        </Button>
        <Button variant={autoCheck ? 'default' : 'primary'} onClick={() => onChoose(false)}>
          Manual lookup
        </Button>
      </div>
    </section>
  );
}

function Status({
  line,
  now,
  busy,
  onLink,
  onRetry,
}: {
  line: StatusLine;
  now: number;
  busy: boolean;
  onLink: LinkHandler;
  onRetry: (force: boolean) => void;
}) {
  const waiting = line.retryAt !== undefined && line.retryAt > now;
  const left = `try again in ${countdown(line.retryAt ?? now, now)}`;
  // A band is about the whole source; a note keeps saying what it is about.
  const text = waiting ? (line.tone === 'band' ? left : `${line.text}, ${left}`) : line.text;
  const { action } = line;
  return (
    <p class={line.tone === 'band' ? 'band' : 'note'}>
      <span class="band-text">
        <span class="band-source">
          <SourceMark source={line.source} />
          {SOURCE_NAMES[line.source]}:
        </span>{' '}
        {text}
      </span>
      {action !== undefined && !waiting && (
        <>
          {action.kind === 'link' ? (
            <a
              class="band-action"
              href={action.url}
              onClick={(event) => onLink(event, action.url)}
              onAuxClick={(event) => onLink(event, action.url)}
            >
              {action.label}
            </a>
          ) : (
            <Button
              variant="text"
              class="band-action"
              aria-disabled={busy}
              onClick={() => {
                if (!busy) onRetry(action.force);
              }}
            >
              {action.label}
            </Button>
          )}
        </>
      )}
    </p>
  );
}

function Empty({
  text,
  submit,
  url,
  title,
  host,
  onLink,
}: {
  text: string;
  submit: SourceId[];
  url: string;
  title: string;
  host: RedditHost;
  onLink: LinkHandler;
}) {
  const links = submitUrls(url, title, host);
  return (
    <div class="empty">
      <p class="empty-lead">{text}</p>
      {submit.length > 0 && (
        <div class="empty-actions">
          {submit.map((source) => (
            <LinkButton
              key={source}
              href={links[source]}
              onClick={(event) => onLink(event, links[source])}
              onAuxClick={(event) => onLink(event, links[source])}
            >
              <SourceMark source={source} />
              Submit to {SOURCE_NAMES[source]}
            </LinkButton>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Popup-wide keys: "/" focuses the URL field, Escape closes the popup, and the arrow keys (plus Home
 * and End) move between the rows and disclosures, starting from the URL field or from nowhere.
 */
function useKeyboard(
  rootRef: RefObject<HTMLDivElement | null>,
  fieldRef: RefObject<HTMLInputElement | null>,
  close: () => void,
) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const root = rootRef.current;
      const field = fieldRef.current;
      const active = document.activeElement;
      const typing =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        field?.focus();
        return;
      }
      if (root === null || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = [...root.querySelectorAll<HTMLElement>('[data-nav]')];
      const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
      const fromField = active === field && field !== null;
      const fromNowhere = active === null || active === document.body;
      if (index === -1 && !fromField && !fromNowhere) return;
      if (fromField && event.key !== 'ArrowDown') return;
      let next: HTMLElement | null | undefined;
      if (event.key === 'Home') next = items[0];
      else if (event.key === 'End') next = items.at(-1);
      else if (event.key === 'ArrowDown') next = items[index + 1];
      else next = index > 0 ? items[index - 1] : field;
      if (next) {
        event.preventDefault();
        next.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [rootRef, fieldRef, close]);
}

/**
 * Keeps keyboard focus on the same thread when late results re-sort the list. Moving a focused node
 * in the DOM drops focus, so the row that had it is focused again after each render.
 */
function useStableFocus(rootRef: RefObject<HTMLDivElement | null>, model: PopupModel) {
  // Read while rendering, before the list below is diffed and its rows moved.
  const active = document.activeElement;
  const focusedKey =
    active instanceof HTMLElement
      ? active.closest<HTMLElement>('[data-key]')?.dataset['key']
      : undefined;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (focusedKey === undefined || root === null) return;
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body) return;
    const row = [...root.querySelectorAll<HTMLElement>('[data-key]')].find(
      (el) => el.dataset['key'] === focusedKey,
    );
    row?.querySelector<HTMLElement>('[data-nav]')?.focus();
  }, [focusedKey, model, rootRef]);
}
