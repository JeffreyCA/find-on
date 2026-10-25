// Auto-saving settings for the options page: changes show at once and are written to storage right
// away, and each write reports where it came from so that section can say "Saved".

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { getSettings, saveSettings, type Settings } from '@/platform/settings';
import { useSettings } from '@/ui/hooks';

export type SettingsChange = (current: Settings) => Settings;

/**
 * The settings as the page shows them, and `update` to change them. A change applies to what the
 * page shows and is written at once, with no read first: the page may be closing (a write that
 * waits for a read never starts then), and storage applies writes in call order, so quick
 * successive changes never overwrite each other. While writes are pending, storage events are
 * ignored (they would briefly show an older value); afterwards the page shows what storage holds,
 * which also undoes a change whose write failed.
 */
export function useSettingsEditor(): {
  settings: Settings | undefined;
  update: (change: SettingsChange) => Promise<void>;
} {
  const stored = useSettings();
  const [local, setLocal] = useState<Settings>();
  const localRef = useRef<Settings | undefined>(undefined);
  const pendingRef = useRef(0);

  const show = useCallback((settings: Settings) => {
    localRef.current = settings;
    setLocal(settings);
  }, []);

  useEffect(() => {
    if (stored !== undefined && pendingRef.current === 0) show(stored);
  }, [stored, show]);

  const update = useCallback(
    (change: SettingsChange) => {
      const current = localRef.current;
      if (current === undefined) return Promise.reject(new Error('Settings not loaded'));
      const next = change(current);
      show(next);
      pendingRef.current += 1;
      return saveSettings(next).finally(() => {
        pendingRef.current -= 1;
        if (pendingRef.current > 0) return;
        getSettings().then(
          (latest) => {
            if (pendingRef.current === 0) show(latest);
          },
          () => undefined,
        );
      });
    },
    [show],
  );

  return { settings: local ?? stored, update };
}

export interface SaveState<S extends string> {
  section: S;
  ok: boolean;
  text: string;
  /** "Saved" fades out (keeping its space) before it is removed. */
  fading: boolean;
}

const SHOW_MS = 1500;
const FADE_MS = 400;

/**
 * The outcome of the latest save, for the section it came from: "Saved" for a moment, or an error
 * that stays until the next save.
 */
export function useSaveState<S extends string>(): [
  state: SaveState<S> | null,
  report: (section: S, error?: unknown) => void,
] {
  const [state, setState] = useState<SaveState<S> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const report = useCallback((section: S, error?: unknown) => {
    clearTimeout(timerRef.current);
    if (error !== undefined) {
      setState({ section, ok: false, text: saveErrorText(error), fading: false });
      return;
    }
    setState({ section, ok: true, text: 'Saved', fading: false });
    timerRef.current = setTimeout(() => {
      setState((s) => s && { ...s, fading: true });
      timerRef.current = setTimeout(() => setState(null), FADE_MS);
    }, SHOW_MS);
  }, []);

  return [state, report];
}

/** storage.sync allows 8 KB per item and about two writes a second. */
export function saveErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('QUOTA_BYTES')) return "Couldn't save: the list is too long";
  if (message.includes('MAX_WRITE_OPERATIONS')) return "Couldn't save. Try again in a minute";
  return "Couldn't save";
}
