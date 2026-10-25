// "Find discussions for this link/page" context menu entries. A click hands the URL to the popup
// through storage.session and opens the popup.

import { browser, type Browser } from '#imports';
import { PENDING_URL_KEY, type PendingUrl } from './messaging';

const LINK_ITEM = 'find-link';
const PAGE_ITEM = 'find-page';
const WEB_PAGES = ['http://*/*', 'https://*/*'];

/** Creates the menu entries. Menus persist, so call this from `runtime.onInstalled` only. */
export async function createMenus(): Promise<void> {
  await browser.contextMenus.removeAll();
  create({
    id: LINK_ITEM,
    title: 'Find discussions for this link',
    contexts: ['link'],
    targetUrlPatterns: WEB_PAGES,
  });
  create({
    id: PAGE_ITEM,
    title: 'Find discussions for this page',
    contexts: ['page'],
    documentUrlPatterns: WEB_PAGES,
  });
}

function create(properties: Browser.contextMenus.CreateProperties): void {
  browser.contextMenus.create(properties, () => {
    // Reading lastError marks it as handled; creation only fails for duplicate ids.
    const error = browser.runtime.lastError;
    if (error) console.warn('Find On: could not create context menu', error.message);
  });
}

/** Registers the click handler. Call synchronously at service worker start. */
export function registerContextMenu(): void {
  browser.contextMenus.onClicked.addListener((info, tab) => {
    void handleMenuClick(info, tab);
  });
}

export async function handleMenuClick(
  info: Browser.contextMenus.OnClickData,
  tab: Browser.tabs.Tab | undefined,
): Promise<void> {
  const url = info.menuItemId === LINK_ITEM ? info.linkUrl : info.pageUrl;
  if (url === undefined) return;
  const pending: PendingUrl = { url, at: Date.now() };
  await browser.storage.session.set({ [PENDING_URL_KEY]: pending });
  try {
    await browser.action.openPopup(tab?.windowId === undefined ? {} : { windowId: tab.windowId });
  } catch (error) {
    // Nobody will take the handoff now; a private window's address must not stay behind.
    await browser.storage.session.remove(PENDING_URL_KEY);
    // openPopup needs a focused normal window. The fallback window would be a regular (not
    // incognito) one and must not leak an incognito page into it.
    if (tab?.incognito) {
      console.warn('Find On: could not open the popup', error);
      return;
    }
    const popup = browser.runtime.getURL('/popup.html');
    await browser.windows.create({
      type: 'popup',
      url: `${popup}?url=${encodeURIComponent(url)}`,
      width: 420,
      height: 600,
    });
  }
}
