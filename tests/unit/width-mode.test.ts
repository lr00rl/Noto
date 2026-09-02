import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  NOTO_SETTINGS_VERSION,
  stepWidthMode,
  WIDTH_MODES,
} from '../../src/shared/settings/v1/contracts';
import {
  coerceSettings,
  isSettingsReplyV1,
  isSettingsWriteRequestV1,
} from '../../src/shared/settings/v1/validate';

const write = (patch: Record<string, unknown>) => isSettingsWriteRequestV1({
  version: NOTO_SETTINGS_VERSION, requestId: 'width', patch,
});

describe('the page width modes', () => {
  it('are the three the plugin has, in the order the chord walks them', () => {
    expect(WIDTH_MODES).toEqual(['default', 'wide', 'full']);
    expect(DEFAULT_SETTINGS.widthMode).toBe('default');
  });

  it('step in a ring, so the chord never lands on nothing', () => {
    expect(stepWidthMode('default', 1)).toBe('wide');
    expect(stepWidthMode('wide', 1)).toBe('full');
    expect(stepWidthMode('full', 1)).toBe('default');
    expect(stepWidthMode('default', -1)).toBe('full');
    expect(stepWidthMode('full', -1)).toBe('wide');
  });

  it('read a settings file from before the modes existed as the default', () => {
    // The measure used to be a character count. A file that still carries one
    // opens at the reading column rather than refusing to load.
    const stored = coerceSettings({ measureCh: 84 });
    expect(stored.widthMode).toBe('default');
    expect(stored).not.toHaveProperty('measureCh');
    expect(coerceSettings({ widthMode: 'huge' }).widthMode).toBe('default');
    expect(coerceSettings({ widthMode: 'full' }).widthMode).toBe('full');
  });

  it('are checked again at the preload boundary, not only when the file is read', () => {
    // The reply guard is what the renderer trusts. It must not fail open on a
    // field that `coerceSettings` happens to have covered up to now.
    const reply = (widthMode: unknown) => isSettingsReplyV1({
      version: NOTO_SETTINGS_VERSION, settings: { ...DEFAULT_SETTINGS, widthMode },
    });
    expect(reply('wide')).toBe(true);
    expect(reply('huge')).toBe(false);
    expect(reply(undefined)).toBe(false);
  });

  it('refuse a write that names a mode the app does not have', () => {
    for (const mode of WIDTH_MODES) expect(write({ widthMode: mode })).toBe(true);
    expect(write({ widthMode: 'wider' })).toBe(false);
    expect(write({ widthMode: 1 })).toBe(false);
    expect(write({ measureCh: 66 })).toBe(false);
  });
});
