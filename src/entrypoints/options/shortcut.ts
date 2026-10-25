// The toolbar button's keyboard shortcut, as Chrome reports it in commands.getAll().

import { browser } from '#imports';
import { useEffect, useState } from 'preact/hooks';

/** Chrome's built-in command that opens the popup. */
const OPEN_POPUP_COMMAND = '_execute_action';

/** Where Chrome and Edge let the user change extension shortcuts. */
export const SHORTCUTS_PAGE = 'chrome://extensions/shortcuts';

/**
 * Splits a shortcut into keys for display: "Alt+Shift+D" on Windows and Linux, "⌥⇧D" on macOS
 * (leading modifier symbols, then the key). An unset shortcut is "".
 */
export function shortcutKeys(shortcut: string): string[] {
  if (shortcut === '') return [];
  if (shortcut.includes('+')) return shortcut.split('+').filter((key) => key !== '');
  const match = /^([⌘⌥⇧⌃]*)(.*)$/u.exec(shortcut);
  const modifiers = match?.[1]?.match(/[⌘⌥⇧⌃]/gu) ?? [];
  const key = match?.[2] ?? '';
  return key === '' ? modifiers : [...modifiers, key];
}

/**
 * The current shortcut ("" when none is set), undefined until read. Read again whenever the page
 * regains focus, since the user changes it on another page.
 */
export function useShortcut(): string | undefined {
  const [shortcut, setShortcut] = useState<string>();
  useEffect(() => {
    let live = true;
    const read = () => {
      browser.commands.getAll().then(
        (commands) => {
          if (live) {
            setShortcut(commands.find((c) => c.name === OPEN_POPUP_COMMAND)?.shortcut ?? '');
          }
        },
        () => {
          if (live) setShortcut('');
        },
      );
    };
    read();
    window.addEventListener('focus', read);
    return () => {
      live = false;
      window.removeEventListener('focus', read);
    };
  }, []);
  return shortcut;
}
