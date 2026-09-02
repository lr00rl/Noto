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
 * or a text size of 400 does not produce an unusual document, it produces an
 * unusable window with no way back except editing the settings file by hand.
 * The floor is as important as the ceiling for the same reason.
 */
export const SETTING_RANGES = Object.freeze({
  fontSize: { min: 13, max: 26, step: 1 },
  lineHeight: { min: 1.3, max: 2.2, step: 0.02 },
  autoSaveDelayMs: { min: 400, max: 10_000, step: 100 },
  /* A vault six levels deep spends 90px of the rail on indentation before the
     first character of a filename. 248px was chosen against a shallow fixture
     and leaves five siblings all reading "Done_TaskGro…" in a real one, so the
     width has to be the reader's to set. */
  railWidth: { min: 190, max: 520, step: 1 },
} as const);

export type NotoNumericSetting = keyof typeof SETTING_RANGES;

/**
 * The three widths of the writing column, in the order `Cmd+]` walks them.
 *
 * Modes rather than a number, because the width is not a number the reader
 * owns: it is a share of whatever canvas is left beside the rail, capped so a
 * paragraph never runs across a 27-inch display. The share and the cap for each
 * mode live in the stylesheet, where the canvas width is known, and each one is
 * `min(canvas - gutters, cap)`. That last clause is the rule the whole thing
 * exists for: the column is never wider than the canvas it sits in, so the
 * document never scrolls sideways, whatever the mode and however narrow the
 * window.
 *
 * `default` is the reading column, up to 860px, which is the width of Typora's
 * own page. `wide` is 78% of the canvas held between 1000px and 1180px, for a
 * code block that runs past the reading column. `full` is everything beside
 * the rail, up to 1680px. Ported from the author's `wider` plugin for Typora,
 * whose numbers were tuned against a real vault.
 */
export const WIDTH_MODES = ['default', 'wide', 'full'] as const;

export type WidthModeV1 = (typeof WIDTH_MODES)[number];

/**
 * The next mode in `direction`, wrapping at either end.
 *
 * A ring rather than a line, as in the plugin: the chord is a single motion
 * ("make it wider") and a press that does nothing at the end of the range reads
 * as a key that is broken rather than as a limit reached.
 */
export function stepWidthMode(current: WidthModeV1, direction: 1 | -1): WidthModeV1 {
  const at = Math.max(0, WIDTH_MODES.indexOf(current));
  return WIDTH_MODES[(at + direction + WIDTH_MODES.length) % WIDTH_MODES.length];
}

export interface NotoSettingsV1 {
  readonly theme: NotoTheme;
  /** Document text size in CSS pixels. */
  readonly fontSize: number;
  /** Unitless line height for document text. */
  readonly lineHeight: number;
  /** How much of the canvas the text column takes. See `WIDTH_MODES`. */
  readonly widthMode: WidthModeV1;
  /** Turn quotes and dashes into their typographic forms as you type. */
  readonly smartTypography: boolean;
  readonly spellCheck: boolean;
  /**
   * Show images that live on the web.
   *
   * On by default, because a third of the author's notes embed one and a
   * picture that does not appear is a broken note. Every one is a request to
   * the server that holds it, though, which is why it is a switch and why the
   * switch says so. Local images are not affected: they are served by main
   * from the open folder and never leave the machine.
   */
  readonly remoteImages: boolean;
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
  // The author's theme: 16px at 1.58 is what he reads all day in Typora, and
  // the width modes' 860px reading column is that theme's width at that size.
  fontSize: 16,
  lineHeight: 1.58,
  widthMode: 'default',
  // On by default because it is what a writing tool should do, and it is
  // reversible per document by undoing the substitution.
  smartTypography: true,
  spellCheck: true,
  remoteImages: true,
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
