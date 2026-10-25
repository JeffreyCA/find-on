// Which page the popup is about: a context-menu handoff (`pending-url`, if fresh),
// else `?url=`, else the active tab. Also parses addresses typed into the URL field.

import { browser, type Browser } from '#imports';
import { isRecord } from '@/core/types';
import { checkEligibility, computeKeys, displayUrl } from '@/core/url';
import { PENDING_URL_KEY, type PendingUrl } from '@/platform/messaging';

/** A context-menu handoff older than this is left over from an earlier popup and ignored. */
export const PENDING_MAX_AGE_MS = 10_000;

/** A page address and what is known about where it came from. */
export interface PageSource {
  url: string;
  /** The tab's title, for Submit links; '' when the URL did not come from a tab. */
  title: string;
  /** Only for the real active tab: its badge follows the popup's lookup. */
  tabId?: number;
  /** The address was typed into the URL field. */
  typed?: boolean;
}

export type Target =
  | {
      kind: 'page';
      url: string;
      /** Short form for the URL field, e.g. "xkcd.com/927". */
      display: string;
      title: string;
      tabId?: number;
      typed: boolean;
    }
  | {
      kind: 'unchecked';
      /** The address as it is ('' when the tab has none). */
      address: string;
      typed: boolean;
    };

export async function initialSource(search: string, now: number): Promise<PageSource> {
  const [handoff, tab] = await Promise.all([takePendingUrl(now), activeTab()]);
  const requested = handoff ?? (new URLSearchParams(search).get('url') || null);
  if (requested === null) return tab ? fromTab(tab) : { url: '', title: '' };
  // A requested URL that is the active tab's own page is that tab, title and badge included.
  if (tab?.url === requested) return fromTab(tab);
  return { url: requested, title: '' };
}

/** Reads and removes the context-menu handoff; returns its URL if it is fresh. */
async function takePendingUrl(now: number): Promise<string | null> {
  try {
    const stored = await browser.storage.session.get(PENDING_URL_KEY);
    const value: unknown = stored[PENDING_URL_KEY];
    if (value === undefined) return null;
    await browser.storage.session.remove(PENDING_URL_KEY);
    if (!isPendingUrl(value)) return null;
    const age = now - value.at;
    return age >= 0 && age < PENDING_MAX_AGE_MS ? value.url : null;
  } catch {
    return null;
  }
}

function isPendingUrl(value: unknown): value is PendingUrl {
  return isRecord(value) && typeof value['url'] === 'string' && typeof value['at'] === 'number';
}

async function activeTab(): Promise<Browser.tabs.Tab | undefined> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab;
  } catch {
    return undefined;
  }
}

function fromTab(tab: Browser.tabs.Tab): PageSource {
  return {
    url: tab.url ?? tab.pendingUrl ?? '',
    title: tab.title ?? '',
    ...(tab.id !== undefined && { tabId: tab.id }),
  };
}

export function toTarget(source: PageSource): Target {
  const typed = source.typed ?? false;
  const eligibility = checkEligibility(source.url);
  const keys = eligibility.ok ? computeKeys(eligibility.url) : null;
  if (keys === null) return { kind: 'unchecked', address: source.url, typed };
  return {
    kind: 'page',
    url: source.url,
    display: displayUrl(keys),
    title: source.title,
    typed,
    ...(source.tabId !== undefined && { tabId: source.tabId }),
  };
}

/** An address typed into the URL field, with "https://" added when it has no scheme. */
export function typedSource(input: string): PageSource {
  const text = input.trim();
  const url = text === '' || text.includes('://') ? text : `https://${text}`;
  return { url, title: '', typed: true };
}

/**
 * Whether the popup belongs to a private window. The background makes the same call for requests
 * without a tab; when in doubt, both err on the private side.
 */
export async function inPrivateWindow(): Promise<boolean> {
  try {
    return (await browser.windows.getCurrent()).incognito;
  } catch {
    return true;
  }
}
