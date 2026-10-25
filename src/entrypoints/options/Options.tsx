// The options page. Every change saves at once, and the section it belongs to says so.

import { browser } from '#imports';
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { DEFAULT_BLOCK_LIST, type SiteFilter } from '@/core/site-filter';
import { onboardedItem, type Settings } from '@/platform/settings';
import { BadgeChip, Logo } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Checkbox, RadioGroup } from '@/ui/Choice';
import { disclosure } from '@/ui/disclosure';
import { useRedditSignIn, useStorageItem } from '@/ui/hooks';
import { RedditSignInStatus } from '@/ui/RedditSignIn';
import { SourceMark } from '@/ui/SourceMark';
import { StatusText } from '@/ui/StatusText';
import { TextArea } from '@/ui/TextArea';
import { useSaveState, useSettingsEditor, type SaveState, type SettingsChange } from './editor';
import { shortcutKeys, SHORTCUTS_PAGE, useShortcut } from './shortcut';
import { hasPatterns, invalidLines, listToText, sameList, textToList } from './sites';

type SectionId = 'lookup' | 'sources' | 'sites' | 'badge' | 'results';
type Save = (section: SectionId, change: SettingsChange) => void;

/** Invalid site lines listed one by one; any beyond this are summed up in one line. */
const MAX_FLAGS = 5;

/** Sample values for the badge preview, rendered with the real badge format. */
const SAMPLE_DISCUSSIONS = 12;
const SAMPLE_COMMENTS = 1480;

interface OptionsProps {
  /** Pause in typing before a site list edit saves, in ms. */
  saveDelay?: number;
}

export function Options({ saveDelay = 600 }: OptionsProps) {
  const { settings, update } = useSettingsEditor();
  const onboarded = useStorageItem(onboardedItem);
  const onboardedRef = useRef(onboarded);
  useLayoutEffect(() => {
    onboardedRef.current = onboarded;
  }, [onboarded]);
  const [saveState, report] = useSaveState<SectionId>();
  const save = useCallback<Save>(
    (section, change) => {
      void update(change).then(
        () => {
          report(section);
          // Changing anything here counts as having seen the settings: automatic checks can start.
          if (onboardedRef.current !== true) {
            onboardedRef.current = true;
            onboardedItem.setValue(true).catch((error: unknown) => {
              console.error('Find On: confirming onboarding failed', error);
            });
          }
        },
        (error: unknown) => report(section, error ?? new Error('Write failed')),
      );
    },
    [update, report],
  );

  if (settings === undefined || onboarded === undefined) return null;
  const statusOf = (id: SectionId) => (saveState?.section === id ? saveState : null);
  const version = extensionVersion();
  const sends = disclosure(settings.sources);

  return (
    <div class="page options">
      <header class="page-head">
        <p class="page-kicker">
          <Logo size={16} />
          <span>Find On</span>
          {version !== '' && <span class="num">{version}</span>}
        </p>
        <h1>Settings</h1>
      </header>

      <Section id="lookup" title="Lookup" status={statusOf('lookup')}>
        <RadioGroup
          legend="Lookup mode"
          // Until a first choice is made (here, in the popup or on the welcome page) nothing is
          // looked up automatically, so neither option shows as chosen.
          value={onboarded ? (settings.autoCheck ? 'auto' : 'manual') : null}
          options={[
            {
              value: 'auto',
              label: 'Automatic',
              hint: 'Looks up each page when it loads, subject to the site filter.',
            },
            {
              value: 'manual',
              label: 'Manual',
              hint: 'Looks up the current page when you click the toolbar button or use the keyboard shortcut.',
            },
          ]}
          onChange={(mode) => save('lookup', (s) => ({ ...s, autoCheck: mode === 'auto' }))}
        />
        {sends !== null && <p class="hint">{sends}</p>}
      </Section>

      <Section id="sources" title="Sources" status={statusOf('sources')}>
        <Sources settings={settings} save={save} />
      </Section>

      <Sites
        filter={settings.siteFilter}
        autoCheck={settings.autoCheck}
        save={save}
        status={statusOf('sites')}
        saveDelay={saveDelay}
      />

      <Section id="badge" title="Toolbar badge" status={statusOf('badge')}>
        <RadioGroup
          legend="Badge value"
          value={settings.badge}
          options={[
            {
              value: 'discussions',
              label: (
                <>
                  Discussion count
                  <BadgePreview value={SAMPLE_DISCUSSIONS} />
                </>
              ),
            },
            {
              value: 'comments',
              label: (
                <>
                  Total comment count
                  <BadgePreview value={SAMPLE_COMMENTS} />
                </>
              ),
            },
          ]}
          onChange={(badge) => save('badge', (s) => ({ ...s, badge }))}
        />
      </Section>

      <Section id="results" title="Results" status={statusOf('results')}>
        <FieldRow label="Displayed count">
          <RadioGroup
            legend="Displayed count"
            inline
            value={settings.rowStat}
            options={[
              { value: 'points', label: 'Points' },
              { value: 'comments', label: 'Comments' },
            ]}
            onChange={(rowStat) => save('results', (s) => ({ ...s, rowStat }))}
          />
        </FieldRow>
        <FieldRow label="Reddit domain">
          <RadioGroup
            legend="Reddit domain"
            inline
            value={settings.redditHost}
            options={[
              { value: 'www', label: 'www.reddit.com' },
              { value: 'old', label: 'old.reddit.com' },
            ]}
            onChange={(redditHost) => save('results', (s) => ({ ...s, redditHost }))}
          />
        </FieldRow>
        <Checkbox
          label="Open links in background tabs"
          checked={settings.openInBackground}
          onChange={(openInBackground) => save('results', (s) => ({ ...s, openInBackground }))}
        />
      </Section>

      <Shortcut />
    </div>
  );
}

/** A label on the left and its inline radios on the right (the radios carry the same name). */
function FieldRow({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="field-row">
      <span class="field-label" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}

function Section({
  id,
  title,
  status,
  children,
}: {
  id: string;
  title: string;
  /** The latest save from this section; omit for a section that saves nothing. */
  status?: SaveState<SectionId> | null;
  children: ComponentChildren;
}) {
  const headingId = `${id}-heading`;
  return (
    <section class="section" aria-labelledby={headingId}>
      <div class="section-head">
        <h2 id={headingId}>{title}</h2>
        {status !== undefined && (
          <output class="section-status">
            {status !== null && (
              <StatusText tone={status.ok ? 'ok' : 'attention'} fading={status.fading}>
                {status.text}
              </StatusText>
            )}
          </output>
        )}
      </div>
      <div class="section-body">{children}</div>
    </section>
  );
}

/**
 * The block or allow list, edited as text. Edits save after a pause in typing, when the field loses
 * focus, and when the page is left. The text follows the stored list (another device, the other
 * mode, Reset to defaults) unless it has unsaved edits.
 */
function Sites({
  filter,
  autoCheck,
  save,
  status,
  saveDelay,
}: {
  filter: SiteFilter;
  autoCheck: boolean;
  save: Save;
  status: SaveState<SectionId> | null;
  saveDelay: number;
}) {
  const { mode } = filter;
  const stored = filter[mode];
  const [text, setText] = useState(() => listToText(stored));
  // The text the line warnings describe: updated when an edit is saved, not on every keystroke.
  const [checked, setChecked] = useState(text);
  // The list as it was before "Reset to defaults", while that can still be undone.
  const [undo, setUndo] = useState<string[] | null>(null);

  // What the timer, blur and pagehide handlers need, kept current outside of render.
  const textRef = useRef(text);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const modeRef = useRef(mode);
  const storedRef = useRef(stored);
  useLayoutEffect(() => {
    modeRef.current = mode;
    storedRef.current = stored;
  }, [mode, stored]);
  const id = useId();
  const flagsId = `${id}-flags`;
  const syntaxId = `${id}-syntax`;

  const show = (next: string) => {
    textRef.current = next;
    setText(next);
    setChecked(next);
  };

  const commit = useCallback(() => {
    clearTimeout(timerRef.current);
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const current = textRef.current;
    setChecked(current);
    const list = textToList(current);
    if (sameList(list, storedRef.current)) return;
    const listMode = modeRef.current;
    save('sites', (s) => withList(s, listMode, list));
  }, [save]);

  // A layout effect, so the text never shows the old list for a frame (e.g. after switching mode),
  // and no effect queued by an earlier render can run after a newer edit and undo it.
  useLayoutEffect(() => {
    if (dirtyRef.current || sameList(textToList(textRef.current), stored)) return;
    const next = listToText(stored);
    textRef.current = next;
    setText(next);
    setChecked(next);
  }, [stored]);

  useEffect(() => {
    window.addEventListener('pagehide', commit);
    return () => {
      window.removeEventListener('pagehide', commit);
      commit();
    };
  }, [commit]);

  const onInput = (next: string) => {
    textRef.current = next;
    setText(next);
    setUndo(null);
    dirtyRef.current = true;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(commit, saveDelay);
  };

  const setMode = (next: SiteFilter['mode']) => {
    commit();
    setUndo(null);
    save('sites', (s) => ({ ...s, siteFilter: { ...s.siteFilter, mode: next } }));
  };

  const restore = () => {
    clearTimeout(timerRef.current);
    dirtyRef.current = false;
    const defaults = [...DEFAULT_BLOCK_LIST];
    setUndo(textToList(textRef.current));
    show(listToText(defaults));
    save('sites', (s) => withList(s, 'block', defaults));
  };

  const undoRestore = () => {
    if (undo === null) return;
    const previous = undo;
    setUndo(null);
    show(listToText(previous));
    save('sites', (s) => withList(s, 'block', previous));
  };

  const flags = invalidLines(checked);
  const isDefault = sameList(textToList(text), DEFAULT_BLOCK_LIST);
  const emptyAllowList = mode === 'allow' && !hasPatterns(textToList(checked));

  return (
    <Section id="sites" title="Site filter" status={status}>
      <div class="list-head">
        <FieldRow label="Filter mode">
          <RadioGroup
            legend="Filter mode"
            inline
            value={mode}
            options={[
              { value: 'block', label: 'Blocklist' },
              { value: 'allow', label: 'Allowlist' },
            ]}
            onChange={setMode}
          />
        </FieldRow>
        {mode === 'block' &&
          (undo !== null && isDefault ? (
            <Button variant="text" onClick={undoRestore}>
              Undo reset
            </Button>
          ) : (
            <Button variant="text" disabled={isDefault} onClick={restore}>
              Reset to defaults
            </Button>
          ))}
      </div>
      <p class="hint">
        {autoCheck
          ? 'Applies to automatic lookups only. Manual lookups always run.'
          : 'Applies to automatic lookups only (currently off).'}
      </p>
      <TextArea
        class="patterns"
        value={text}
        onInput={onInput}
        onBlur={commit}
        rows={6}
        placeholder="example.com"
        aria-label={mode === 'block' ? 'Blocklist patterns' : 'Allowlist patterns'}
        aria-describedby={`${flagsId} ${syntaxId}`}
        aria-invalid={flags.length > 0}
      />
      <ul class="flags" id={flagsId}>
        {flags.slice(0, MAX_FLAGS).map((flag) => (
          <li key={flag.line}>
            <StatusText tone="attention">
              <span>
                Line {flag.line} ignored: invalid pattern <code>{flag.text}</code>
              </span>
            </StatusText>
          </li>
        ))}
        {flags.length > MAX_FLAGS && (
          <li>
            <StatusText tone="attention">{flags.length - MAX_FLAGS} more lines ignored</StatusText>
          </li>
        )}
        {emptyAllowList && flags.length === 0 && (
          <li class="hint">The allowlist is empty, so no pages are looked up automatically.</li>
        )}
      </ul>
      <p class="hint" id={syntaxId}>
        One pattern per line: <code>example.com</code> or <code>example.com/path</code>. Patterns
        match subdomains; <code>example.*</code> matches any TLD (example.de, example.co.uk).
      </p>
    </Section>
  );
}

function withList(s: Settings, mode: SiteFilter['mode'], list: string[]): Settings {
  const siteFilter =
    mode === 'block' ? { ...s.siteFilter, block: list } : { ...s.siteFilter, allow: list };
  return { ...s, siteFilter };
}

function Sources({ settings, save }: { settings: Settings; save: Save }) {
  const { hn, reddit } = settings.sources;
  // "Sign in on reddit.com" opens another tab; look again when the user comes back from it, but only
  // while Reddit is on.
  const { status, check } = useRedditSignIn({ onFocus: reddit });
  const set = (source: keyof Settings['sources'], on: boolean) =>
    save('sources', (s) => ({
      ...s,
      sources: source === 'hn' ? { ...s.sources, hn: on } : { ...s.sources, reddit: on },
    }));

  return (
    <>
      <Checkbox
        label={
          <>
            <SourceMark source="hn" />
            Hacker News
          </>
        }
        checked={hn}
        onChange={(on) => set('hn', on)}
      />
      <div class="line">
        <Checkbox
          label={
            <>
              <SourceMark source="reddit" />
              Reddit
            </>
          }
          hint="Requires a reddit.com session."
          checked={reddit}
          onChange={(on) => set('reddit', on)}
        />
        {reddit && <RedditSignInStatus status={status} check={check} host={settings.redditHost} />}
      </div>
      {!hn && !reddit && <StatusText tone="attention">No sources enabled</StatusText>}
    </>
  );
}

/** The toolbar badge as it renders for a sample value. Decorative: the label says what it counts. */
function BadgePreview({ value }: { value: number }) {
  return (
    <span class="badge-preview" aria-hidden="true">
      <BadgeChip value={value} />
    </span>
  );
}

function Shortcut() {
  const shortcut = useShortcut();
  const keys = shortcutKeys(shortcut ?? '');
  return (
    <Section id="shortcut" title="Keyboard shortcut">
      <div class="shortcut">
        <span>Open popup</span>
        {shortcut !== undefined &&
          (keys.length > 0 ? (
            <span class="keys">
              <span class="visually-hidden">{keys.join('+')}</span>
              {keys.map((key) => (
                <kbd key={key} aria-hidden="true">
                  {key}
                </kbd>
              ))}
            </span>
          ) : (
            <span class="shortcut-none">Not set</span>
          ))}
        <Button
          variant="text"
          class="shortcut-change"
          aria-label="Configure keyboard shortcut"
          onClick={() => {
            browser.tabs.create({ url: SHORTCUTS_PAGE }).catch((error: unknown) => {
              console.error('Find On: opening the shortcuts page failed', error);
            });
          }}
        >
          Configure
        </Button>
      </div>
    </Section>
  );
}

function extensionVersion(): string {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return '';
  }
}
