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
} as const;

/** `system` follows the operating system, which is the honest default. */
export type NotoTheme = 'light' | 'dark' | 'system';

/**
 * How wide the text column is allowed to grow.
 *
 * A measure rather than a pixel width, because comfortable line length is what
 * this actually controls and it should hold as the font size changes.
 */
export type NotoMeasure = 'narrow' | 'medium' | 'wide';

export interface NotoSettingsV1 {
  readonly theme: NotoTheme;
  readonly measure: NotoMeasure;
  /** Turn quotes and dashes into their typographic forms as you type. */
  readonly smartTypography: boolean;
  readonly spellCheck: boolean;
  /** Show the workspace tree when the app starts. */
  readonly sidebarOnLaunch: boolean;
}

export const DEFAULT_SETTINGS: NotoSettingsV1 = Object.freeze({
  theme: 'system',
  measure: 'medium',
  // On by default because it is what a writing tool should do, and it is
  // reversible per document by undoing the substitution.
  smartTypography: true,
  spellCheck: true,
  sidebarOnLaunch: false,
});

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

export interface NotoSettingsApiV1 {
  read(request: SettingsRequestV1): Promise<SettingsResultV1<SettingsReplyV1>>;
  write(request: SettingsWriteRequestV1): Promise<SettingsResultV1<SettingsReplyV1>>;
  onChanged(listener: (event: SettingsReplyV1) => void): () => void;
}
