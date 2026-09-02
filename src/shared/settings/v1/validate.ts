/**
 * Settings validation.
 *
 * A settings file is user-writable and survives upgrades, so it is exactly the
 * kind of input that arrives malformed. Every field is checked individually and
 * an unusable one falls back to its default rather than failing the whole read,
 * because losing one preference is better than starting with none.
 */

import {
  clampSetting,
  DEFAULT_SETTINGS,
  NOTO_SETTINGS_VERSION,
  SETTING_RANGES,
  WIDTH_MODES,
  type NotoNumericSetting,
  type NotoSettingsV1,
  type NotoTheme,
  type SettingsReplyV1,
  type SettingsRequestV1,
  type SettingsResultV1,
  type SettingsWriteRequestV1,
  type ThemeCssReplyV1,
  type WidthModeV1,
} from './contracts';

const requestId = /^[A-Za-z0-9._:-]{1,96}$/;
const themes: readonly NotoTheme[] = ['light', 'dark', 'system'];
const isWidthMode = (value: unknown): value is WidthModeV1 =>
  (WIDTH_MODES as readonly unknown[]).includes(value);
const numericKeys = Object.keys(SETTING_RANGES) as NotoNumericSetting[];
const isNumericKey = (key: string): key is NotoNumericSetting =>
  (numericKeys as string[]).includes(key);

/**
 * A stylesheet path.
 *
 * Absolute, because a relative one is resolved against whatever the process
 * happens to consider its working directory. Bounded, and free of the NUL and
 * newline that would let a path smuggle a second argument into anything that
 * later logs or shells it.
 */
const isCssPath = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length <= 1024
  && !/[\0\r\n]/.test(value)
  && (value === '' || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value));

const numeric = (value: Record<string, unknown>, key: NotoNumericSetting): number =>
  clampSetting(key, value[key]);

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof NotoSettingsV1)[];

/** Read whatever is usable, and fall back for whatever is not. */
export function coerceSettings(value: unknown): NotoSettingsV1 {
  if (!record(value)) return DEFAULT_SETTINGS;
  return {
    theme: themes.includes(value.theme as NotoTheme) ? value.theme as NotoTheme : DEFAULT_SETTINGS.theme,
    fontSize: numeric(value, 'fontSize'),
    lineHeight: numeric(value, 'lineHeight'),
    widthMode: isWidthMode(value.widthMode) ? value.widthMode : DEFAULT_SETTINGS.widthMode,
    smartTypography: typeof value.smartTypography === 'boolean'
      ? value.smartTypography
      : DEFAULT_SETTINGS.smartTypography,
    spellCheck: typeof value.spellCheck === 'boolean' ? value.spellCheck : DEFAULT_SETTINGS.spellCheck,
    remoteImages: typeof value.remoteImages === 'boolean' ? value.remoteImages : DEFAULT_SETTINGS.remoteImages,
    codeLineNumbers: typeof value.codeLineNumbers === 'boolean'
      ? value.codeLineNumbers
      : DEFAULT_SETTINGS.codeLineNumbers,
    sidebarOnLaunch: typeof value.sidebarOnLaunch === 'boolean'
      ? value.sidebarOnLaunch
      : DEFAULT_SETTINGS.sidebarOnLaunch,
    railWidth: numeric(value, 'railWidth'),
    autoSave: typeof value.autoSave === 'boolean' ? value.autoSave : DEFAULT_SETTINGS.autoSave,
    autoSaveDelayMs: numeric(value, 'autoSaveDelayMs'),
    customCssPath: isCssPath(value.customCssPath)
      ? value.customCssPath
      : DEFAULT_SETTINGS.customCssPath,
  };
}

/**
 * A patch from the renderer.
 *
 * Stricter than a read: an unknown key or a wrong type is rejected outright
 * rather than dropped, because a write that silently does nothing is worse than
 * one that reports failure.
 */
export function isSettingsWriteRequestV1(value: unknown): value is SettingsWriteRequestV1 {
  if (!record(value) || value.version !== NOTO_SETTINGS_VERSION
    || typeof value.requestId !== 'string' || !requestId.test(value.requestId)
    || !record(value.patch)) return false;

  const patch = value.patch;
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.length > SETTING_KEYS.length) return false;
  return keys.every((key) => {
    if (!SETTING_KEYS.includes(key as keyof NotoSettingsV1)) return false;
    if (key === 'theme') return themes.includes(patch.theme as NotoTheme);
    if (key === 'widthMode') return isWidthMode(patch.widthMode);
    if (key === 'customCssPath') return isCssPath(patch.customCssPath);
    // Out of range is refused rather than clamped: a write says what it wants,
    // and silently storing something else is the kind of disagreement that
    // shows up later as a control that will not move.
    if (isNumericKey(key)) {
      const candidate = patch[key];
      const range = SETTING_RANGES[key];
      return typeof candidate === 'number' && Number.isFinite(candidate)
        && candidate >= range.min && candidate <= range.max;
    }
    return typeof patch[key] === 'boolean';
  });
}

export function isSettingsRequestV1(value: unknown): value is SettingsRequestV1 {
  return record(value) && value.version === NOTO_SETTINGS_VERSION
    && Object.keys(value).length === 2
    && typeof value.requestId === 'string' && requestId.test(value.requestId);
}

export function isSettingsReplyV1(value: unknown): value is SettingsReplyV1 {
  if (!record(value) || value.version !== NOTO_SETTINGS_VERSION || !record(value.settings)) return false;
  const settings = value.settings;
  return themes.includes(settings.theme as NotoTheme)
    && isWidthMode(settings.widthMode)
    && numericKeys.every((key) => typeof settings[key] === 'number' && Number.isFinite(settings[key]))
    && typeof settings.smartTypography === 'boolean'
    && typeof settings.spellCheck === 'boolean'
    && typeof settings.remoteImages === 'boolean'
    && typeof settings.codeLineNumbers === 'boolean'
    && typeof settings.sidebarOnLaunch === 'boolean'
    && typeof settings.autoSave === 'boolean'
    && isCssPath(settings.customCssPath);
}

export function isSettingsResultV1(
  value: unknown,
  expectedRequestId: string,
): value is SettingsResultV1<SettingsReplyV1> {
  if (!record(value) || value.requestId !== expectedRequestId) return false;
  if (value.ok === true) return isSettingsReplyV1(value.value);
  return value.ok === false && record(value.error)
    && typeof value.error.code === 'string' && typeof value.error.message === 'string';
}

export function isThemeCssReplyV1(value: unknown): value is ThemeCssReplyV1 {
  return record(value) && value.version === NOTO_SETTINGS_VERSION
    && typeof value.css === 'string' && typeof value.problem === 'string';
}

export function isThemeCssResultV1(
  value: unknown,
  expectedRequestId: string,
): value is SettingsResultV1<ThemeCssReplyV1> {
  if (!record(value) || value.requestId !== expectedRequestId) return false;
  if (value.ok === true) return isThemeCssReplyV1(value.value);
  return value.ok === false && record(value.error)
    && typeof value.error.code === 'string' && typeof value.error.message === 'string';
}
