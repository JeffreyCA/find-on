// Connects the popup view to the browser: the lookup controller, settings, link opening and the
// onboarding choice.

import { browser, type Browser } from '#imports';
import { useMemo, useRef } from 'preact/hooks';
import {
  mentionsOpenItem,
  normalizeOrder,
  onboardedItem,
  seenVersionItem,
  sortItem,
  sourceOrderItem,
} from '@/platform/settings';
import { updateSettings, useSettings, useStorageItem } from '@/ui/hooks';
import { anchorTab, openExtensionPage, openModeFor, openTab } from '@/ui/links';
import { usePopup } from './controller';
import { Popup, type PopupActions } from './Popup';

export function App() {
  const popup = usePopup();
  const settings = useSettings();
  const onboarded = useStorageItem(onboardedItem);
  const sort = useStorageItem(sortItem);
  const order = useStorageItem(sourceOrderItem);
  const mentionsOpen = useStorageItem(mentionsOpenItem);
  // Updated since the settings page was last opened: its "What's new" has something to show.
  const seenVersion = useStorageItem(seenVersionItem);
  const whatsNew =
    seenVersion !== undefined && seenVersion !== browser.runtime.getManifest().version;

  // Background tabs opened from this popup line up after the current tab in click order.
  const openedRef = useRef(0);
  const anchorRef = useRef<Promise<Browser.tabs.Tab | undefined> | null>(null);
  const openInBackground = settings?.openInBackground ?? false;
  const { check, recheck } = popup;

  const actions = useMemo<PopupActions>(() => {
    const close = () => window.close();
    return {
      check,
      recheck,
      close,
      setSort: (next) => void sortItem.setValue(next),
      setOrder: (next) => void sourceOrderItem.setValue(next),
      setTextPosts: (textPosts) => {
        void updateSettings({ textPosts }).catch((error: unknown) =>
          console.error('Find On: saving the setting failed', error),
        );
      },
      setMentionsOpen: (next) => void mentionsOpenItem.setValue(next),
      openLink: (event, url) => {
        const mode = openModeFor(event, openInBackground);
        if (mode === 'browser-default') return;
        event.preventDefault();
        anchorRef.current ??= anchorTab();
        const offset = mode === 'background' ? openedRef.current++ : 0;
        void anchorRef.current
          .then((nextTo) => openTab(url, { active: mode === 'foreground', nextTo, offset }))
          .then(
            () => {
              if (mode === 'foreground') close();
            },
            (error: unknown) => console.error('Find On: opening a tab failed', error),
          );
      },
      openSettings: () => {
        const opened = whatsNew
          ? openExtensionPage('/options.html#whats-new')
          : browser.runtime.openOptionsPage();
        void opened.then(close, (error: unknown) => {
          console.error('Find On: opening settings failed', error);
        });
      },
      openDetails: () => {
        void openExtensionPage('/welcome.html').then(close, (error: unknown) => {
          console.error('Find On: opening the welcome page failed', error);
        });
      },
      chooseMode: (autoCheck) => {
        void updateSettings({ autoCheck })
          .then(() => onboardedItem.setValue(true))
          .catch((error: unknown) => console.error('Find On: saving the choice failed', error));
      },
    };
  }, [check, recheck, openInBackground, whatsNew]);

  if (popup.target === null || settings === undefined) return null;
  return (
    <Popup
      target={popup.target}
      result={popup.result}
      busy={popup.busy}
      incognito={popup.incognito}
      settings={settings}
      onboarded={onboarded ?? true}
      sort={sort ?? settings.rowStat}
      order={normalizeOrder(order)}
      mentionsOpen={mentionsOpen ?? null}
      whatsNew={whatsNew}
      actions={actions}
    />
  );
}
