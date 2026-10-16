/**
 * Auto-save preferences (issue #135).
 *
 * Files opened from disk do not auto-save by default, so upgrading changes
 * nothing. The interval feeds setInterval directly, so it is clamped: a
 * corrupted value must never turn into a timer that fires continuously.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const KEY_FILES = 'writeadraft:autoSaveFiles';
const KEY_INTERVAL = 'writeadraft:autoSaveIntervalSeconds';

async function freshStore() {
  vi.resetModules();
  const mod = await import('./settingsStore');
  return mod.useSettingsStore;
}

beforeEach(() => {
  localStorage.removeItem(KEY_FILES);
  localStorage.removeItem(KEY_INTERVAL);
});

describe('auto-save settings', () => {
  it('keeps the existing behaviour by default', async () => {
    const store = await freshStore();
    expect(store.getState().autoSaveFiles).toBe(false);
    expect(store.getState().autoSaveIntervalSeconds).toBe(30);
  });

  it('remembers the writer\'s choices across a restart', async () => {
    let store = await freshStore();
    store.getState().setAutoSaveFiles(true);
    store.getState().setAutoSaveIntervalSeconds(120);

    store = await freshStore();
    expect(store.getState().autoSaveFiles).toBe(true);
    expect(store.getState().autoSaveIntervalSeconds).toBe(120);
  });

  it('clamps the interval it is given', async () => {
    const store = await freshStore();
    store.getState().setAutoSaveIntervalSeconds(0);
    expect(store.getState().autoSaveIntervalSeconds).toBe(5);
    store.getState().setAutoSaveIntervalSeconds(1_000_000);
    expect(store.getState().autoSaveIntervalSeconds).toBe(3600);
  });

  it('ignores a stored interval that is not a number', async () => {
    localStorage.setItem(KEY_INTERVAL, 'soon');
    const store = await freshStore();
    expect(store.getState().autoSaveIntervalSeconds).toBe(30);
  });
});
