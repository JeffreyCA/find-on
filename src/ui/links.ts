// Opening links from extension pages in tabs, following the popup's click rules:
// plain click opens a tab next to the current one (in the background if the user prefers),
// Ctrl/Cmd/middle click opens a background tab, Shift click is left to the browser.

import { browser, type Browser } from '#imports';

export type OpenMode = 'foreground' | 'background' | 'browser-default';

/** How a click (or auxclick) on a link should open it. */
export function openModeFor(
  event: Pick<MouseEvent, 'button' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  openInBackground: boolean,
): OpenMode {
  if (event.shiftKey || event.altKey) return 'browser-default';
  if (event.button === 1 || event.ctrlKey || event.metaKey) return 'background';
  if (event.button !== 0) return 'browser-default';
  return openInBackground ? 'background' : 'foreground';
}

export interface OpenTabOptions {
  active: boolean;
  /** Open right after this tab, in its window, with it as the opener. */
  nextTo?: Browser.tabs.Tab | undefined;
  /** Extra positions after `nextTo`, so several background tabs keep their click order. */
  offset?: number;
}

export async function openTab(url: string, { active, nextTo, offset = 0 }: OpenTabOptions) {
  if (nextTo?.id !== undefined) {
    try {
      await browser.tabs.create({
        url,
        active,
        windowId: nextTo.windowId,
        index: nextTo.index + 1 + offset,
        openerTabId: nextTo.id,
      });
      return;
    } catch {
      // The anchor tab closed or its window can't hold tabs; open it the plain way.
    }
  }
  await browser.tabs.create({ url, active });
}

/**
 * The tab new tabs should open next to: the active tab of the window this page belongs to, unless
 * that is an extension page (the popup opened in a window of its own).
 */
export async function anchorTab(): Promise<Browser.tabs.Tab | undefined> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.startsWith(browser.runtime.getURL('/'))) return undefined;
    return tab;
  } catch {
    return undefined;
  }
}

/** Opens an extension page (e.g. '/welcome.html') in a new foreground tab. */
export async function openExtensionPage(path: '/welcome.html' | '/options.html') {
  await browser.tabs.create({ url: browser.runtime.getURL(path) });
}
