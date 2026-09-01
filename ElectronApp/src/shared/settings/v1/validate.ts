/**
 * Settings validation.
 *
 * A settings file is user-writable and survives upgrades, so it is exactly the
 * kind of input that arrives malformed. Every field is checked individually and
 * an unusable one falls back to its default rather than failing the whole read,
 * because losing one preference is better than starting with none.
 */

import {
  DEFAULT_SETTINGS,
  NOTO_SETTINGS_VERSION,
  type NotoMeasure,
  type NotoSettingsV1,
  type NotoTheme,
  type SettingsReplyV1,
  type SettingsRequestV1,
  type SettingsResultV1,
  type SettingsWriteRequestV1,
} from './contracts';

const requestId = /^[A-Za-z0-9._:-]{1,96}$/;
const themes: readonly NotoTheme[] = ['light', 'dark', 'system'];
const measures: readonly NotoMeasure[] = ['narrow', 'medium', 'wide'];

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof NotoSettingsV1)[];

/** Read whatever is usable, and fall back for whatever is not. */
export function coerceSettings(value: unknown): NotoSettingsV1 {
  if (!record(value)) return DEFAULT_SETTINGS;
  return {
    theme: themes.includes(value.theme as NotoTheme) ? value.theme as NotoTheme : DEFAULT_SETTINGS.theme,
    measure: measures.includes(value.measure as NotoMeasure)
      ? value.measure as NotoMeasure
      : DEFAULT_SETTINGS.measure,
    smartTypography: typeof value.smartTypography === 'boolean'
      ? value.smartTypography
      : DEFAULT_SETTINGS.smartTypography,
    spellCheck: typeof value.spellCheck === 'boolean' ? value.spellCheck : DEFAULT_SETTINGS.spellCheck,
    sidebarOnLaunch: typeof value.sidebarOnLaunch === 'boolean'
      ? value.sidebarOnLaunch
      : DEFAULT_SETTINGS.sidebarOnLaunch,
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
    if (key === 'measure') return measures.includes(patch.measure as NotoMeasure);
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
    && measures.includes(settings.measure as NotoMeasure)
    && typeof settings.smartTypography === 'boolean'
    && typeof settings.spellCheck === 'boolean'
    && typeof settings.sidebarOnLaunch === 'boolean';
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
