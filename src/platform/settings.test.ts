import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from './settings';

describe('settings', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('uses the defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('fills in fields the stored settings lack, nested objects per key', async () => {
    await fakeBrowser.storage.sync.set({
      'settings.autoCheck': false,
      'settings.sources': { reddit: false },
      'settings.siteFilter': { mode: 'allow' },
    });
    expect(await getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      autoCheck: false,
      sources: { hn: true, reddit: false },
      siteFilter: { ...DEFAULT_SETTINGS.siteFilter, mode: 'allow' },
    });
  });

  it('writes only the settings that changed, keeping changes made elsewhere meanwhile', async () => {
    const seen = await getSettings();
    // Another page turns Reddit off after this page read the settings.
    await fakeBrowser.storage.sync.set({ 'settings.sources': { hn: true, reddit: false } });
    await saveSettings({ ...seen, autoCheck: false }, seen);
    expect(await getSettings()).toMatchObject({
      autoCheck: false,
      sources: { hn: true, reddit: false },
    });
  });
});
