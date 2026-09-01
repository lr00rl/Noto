/**
 * The numeric settings and the custom stylesheet path.
 *
 * These reach CSS and the filesystem respectively, which is why the range and
 * the shape are contracts rather than suggestions: a line height of 40 makes a
 * window with no way back except editing the settings file by hand, and a
 * relative stylesheet path resolves against whatever the process happens to
 * consider its working directory.
 */

import { describe, expect, it } from 'vitest';
import {
  clampSetting,
  DEFAULT_SETTINGS,
  NOTO_SETTINGS_VERSION,
  SETTING_RANGES,
} from '../../src/shared/settings/v1/contracts';
import { coerceSettings, isSettingsWriteRequestV1 } from '../../src/shared/settings/v1/validate';

const write = (patch: unknown) => isSettingsWriteRequestV1({
  version: NOTO_SETTINGS_VERSION, requestId: 'settings-write:1', patch,
});

describe('numeric settings', () => {
  it('clamps a stored value into its range rather than losing the file', () => {
    expect(clampSetting('fontSize', 4)).toBe(SETTING_RANGES.fontSize.min);
    expect(clampSetting('fontSize', 400)).toBe(SETTING_RANGES.fontSize.max);
    expect(clampSetting('lineHeight', 1.8)).toBe(1.8);
  });

  it('falls back for a value that is not a finite number', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '18', null, undefined, {}]) {
      expect(clampSetting('fontSize', bad)).toBe(DEFAULT_SETTINGS.fontSize);
    }
  });

  it('reads a settings file written by an older build, giving new keys defaults', () => {
    const old = { theme: 'dark', smartTypography: false };
    expect(coerceSettings(old)).toEqual({
      ...DEFAULT_SETTINGS, theme: 'dark', smartTypography: false,
    });
  });

  it('coerces an out-of-range stored value instead of refusing the whole file', () => {
    const stored = coerceSettings({ fontSize: 999, lineHeight: 0, measureCh: 66 });
    expect(stored.fontSize).toBe(SETTING_RANGES.fontSize.max);
    expect(stored.lineHeight).toBe(SETTING_RANGES.lineHeight.min);
    expect(stored.measureCh).toBe(66);
  });

  it('refuses an out-of-range write rather than silently storing something else', () => {
    expect(write({ fontSize: 18 })).toBe(true);
    expect(write({ fontSize: SETTING_RANGES.fontSize.max + 1 })).toBe(false);
    expect(write({ fontSize: SETTING_RANGES.fontSize.min - 1 })).toBe(false);
    expect(write({ lineHeight: Number.NaN })).toBe(false);
    expect(write({ measureCh: '66' })).toBe(false);
  });
});

describe('the custom stylesheet path', () => {
  it('accepts an absolute path and clearing it', () => {
    expect(write({ customCssPath: '/Users/someone/theme.css' })).toBe(true);
    expect(write({ customCssPath: '' })).toBe(true);
    expect(write({ customCssPath: 'C:\\Users\\someone\\theme.css' })).toBe(true);
  });

  it('refuses a relative path, an over-long one, and one carrying control characters', () => {
    expect(write({ customCssPath: 'theme.css' })).toBe(false);
    expect(write({ customCssPath: './theme.css' })).toBe(false);
    expect(write({ customCssPath: `/${'a'.repeat(1_100)}` })).toBe(false);
    expect(write({ customCssPath: '/tmp/theme.css\nrm -rf' })).toBe(false);
    expect(write({ customCssPath: '/tmp/theme\0.css' })).toBe(false);
  });

  it('drops an unusable stored path back to none', () => {
    expect(coerceSettings({ customCssPath: 'relative.css' }).customCssPath).toBe('');
    expect(coerceSettings({ customCssPath: 42 }).customCssPath).toBe('');
  });
});
