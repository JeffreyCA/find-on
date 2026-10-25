import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, getSettings } from './settings';

describe('settings', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('uses the defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('fills in fields the stored settings lack, nested objects per key', async () => {
    await fakeBrowser.storage.sync.set({
      settings: { autoCheck: false, sources: { reddit: false }, siteFilter: { mode: 'allow' } },
    });
    expect(await getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      autoCheck: false,
      sources: { hn: true, reddit: false },
      siteFilter: { ...DEFAULT_SETTINGS.siteFilter, mode: 'allow' },
    });
  });
});
