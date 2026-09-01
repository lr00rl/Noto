/**
 * User settings.
 *
 * Deliberately short. Every setting here changes something the user can see,
 * and each one is a promise to keep working: a preference that outlives its
 * feature becomes dead weight in a file we still have to read and migrate.
 *
 * Main owns the stored value so the choice survives a reload and applies to
 * every window, and so the renderer never writes to disk directly.
 */

export const NOTO_SETTINGS_VERSION = 1 as const;

export const SETTINGS_CHANNELS = {
  read: 'noto:v1:settings:read',
  write: 'noto:v1:settings:write',
  changed: 'noto:v1:settings:changed',
  /** Reads the stylesheet at `customCssPath`. Main owns the path; the renderer
   *  never names a file, so this cannot be pointed at anything else. */
  themeCss: 'noto:v1:settings:theme-css',
} as const;

/** `system` follows the operating system, which is the honest default. */
export type NotoTheme = 'light' | 'dark' | 'system';

/**
 * Numeric settings, with the range each one is clamped to.
 *
 * Bounds rather than free numbers because these reach CSS: a line height of 40
 * or a measure of 5000 characters does not produce an unusual document, it
 * produces an unusable window with no way back except editing the settings file
 * by hand. The floor is as important as the ceiling for the same reason.
 *
 * The measure is in characters rather than pixels because comfortable line
 * length is what it actually controls, and it should hold as the font size
 * changes. It replaces a three-way narrow/medium/wide preset, which could not
 * say 68 when 66 and 74 were both wrong.
 */
export const SETTING_RANGES = Object.freeze({
  fontSize: { min: 13, max: 26, step: 1 },
  lineHeight: { min: 1.3, max: 2.2, step: 0.02 },
  measureCh: { min: 46, max: 110, step: 1 },
  autoSaveDelayMs: { min: 400, max: 10_000, step: 100 },
  /* A vault six levels deep spends 90px of the rail on indentation before the
     first character of a filename. 248px was chosen against a shallow fixture
     and leaves five siblings all reading "Done_TaskGro…" in a real one, so the
     width has to be the reader's to set. */
  railWidth: { min: 190, max: 520, step: 1 },
} as const);

export type NotoNumericSetting = keyof typeof SETTING_RANGES;

export interface NotoSettingsV1 {
  readonly theme: NotoTheme;
  /** Document text size in CSS pixels. */
  readonly fontSize: number;
  /** Unitless line height for document text. */
  readonly lineHeight: number;
  /** Width of the text column, in characters of the prose font. */
  readonly measureCh: number;
  /** Turn quotes and dashes into their typographic forms as you type. */
  readonly smartTypography: boolean;
  readonly spellCheck: boolean;
  /** Show the workspace tree when the app starts. */
  readonly sidebarOnLaunch: boolean;
  /** Width of the navigation rail, in CSS pixels. Dragged, not typed. */
  readonly railWidth: number;
  /**
   * Save on a timer after typing stops.
   *
   * Off by default. Noto refuses a save whose file has changed underneath it,
   * and an automatic save turns that refusal into something that happens while
   * nobody is looking, so it is a choice rather than a default.
   */
  readonly autoSave: boolean;
  readonly autoSaveDelayMs: number;
  /**
   * Absolute path to a stylesheet layered over the theme, or '' for none.
   *
   * A path rather than the stylesheet itself: a theme is a file someone edits
   * in their own editor and reloads, not a blob pasted into a preferences
   * field.
   */
  readonly customCssPath: string;
}

export const DEFAULT_SETTINGS: NotoSettingsV1 = Object.freeze({
  theme: 'system',
  fontSize: 18,
  lineHeight: 1.62,
  measureCh: 66,
  // On by default because it is what a writing tool should do, and it is
  // reversible per document by undoing the substitution.
  smartTypography: true,
  spellCheck: true,
  sidebarOnLaunch: false,
  railWidth: 248,
  autoSave: false,
  autoSaveDelayMs: 1_200,
  customCssPath: '',
});

/** Clamp to the declared range and drop anything that is not a real number. */
export function clampSetting(key: NotoNumericSetting, value: unknown): number {
  const range = SETTING_RANGES[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS[key];
  return Math.min(range.max, Math.max(range.min, value));
}

export interface SettingsRequestV1 {
  readonly version: typeof NOTO_SETTINGS_VERSION;
  readonly requestId: string;
}

export interface SettingsWriteRequestV1 extends SettingsRequestV1 {
  /** Only the keys being changed, so two writers cannot clobber each other. */
  readonly patch: Partial<NotoSettingsV1>;
}

export interface SettingsReplyV1 {
  readonly version: typeof NOTO_SETTINGS_VERSION;
  readonly settings: NotoSettingsV1;
}

export type SettingsResultV1<T> =
  | { readonly ok: true; readonly requestId: string; readonly value: T }
  | {
      readonly ok: false;
      readonly requestId: string;
      readonly error: { readonly code: string; readonly message: string };
    };

export interface ThemeCssReplyV1 {
  readonly version: typeof NOTO_SETTINGS_VERSION;
  /** The stylesheet's text, or '' when no path is set or it cannot be read. */
  readonly css: string;
  /** What went wrong, for the preferences row to show. '' when it did not. */
  readonly problem: string;
}

/** Past this, a stylesheet is a mistake rather than a theme. */
export const THEME_CSS_MAX_BYTES = 512 * 1024;

export interface NotoSettingsApiV1 {
  read(request: SettingsRequestV1): Promise<SettingsResultV1<SettingsReplyV1>>;
  write(request: SettingsWriteRequestV1): Promise<SettingsResultV1<SettingsReplyV1>>;
  readThemeCss(request: SettingsRequestV1): Promise<SettingsResultV1<ThemeCssReplyV1>>;
  onChanged(listener: (event: SettingsReplyV1) => void): () => void;
}
