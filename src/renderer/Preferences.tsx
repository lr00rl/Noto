/**
 * Preferences.
 *
 * One dialog with sections, rather than a settings sheet plus a plugin drawer
 * that lived on opposite sides of the window. Plugins are configuration: they
 * are turned on once and then forgotten, which is what a preferences section is
 * for and what a permanent right sidebar is not. That sidebar also pushed the
 * document sideways every time it opened.
 *
 * Every control writes immediately rather than collecting changes behind a Save
 * button. A preferences dialog with an OK button asks the user to predict what a
 * setting does; applying it at once lets them see it and change their mind,
 * which is the whole reason these are visible settings and not a config file.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  SETTING_RANGES,
  type NotoNumericSetting,
  type NotoSettingsV1,
  type NotoTheme,
  type WidthModeV1,
} from '../shared/settings/v1/contracts';

export type PreferencesSection = 'appearance' | 'editor' | 'plugins';

export interface PreferencesProps {
  readonly open: boolean;
  readonly section: PreferencesSection;
  readonly onSection: (section: PreferencesSection) => void;
  readonly settings: NotoSettingsV1;
  readonly onChange: (patch: Partial<NotoSettingsV1>) => void;
  readonly onClose: () => void;
  /** The plugin section's contents, supplied by the shell so this file stays
   *  free of plugin lifecycle concerns. */
  readonly plugins: ReactNode;
  /** Why the custom stylesheet is not showing, if it is not. */
  readonly themeProblem: string;
  /** Re-read the stylesheet from disk, for when its contents changed but its
   *  path did not. */
  readonly onReloadCss: () => void;
}

const SECTIONS: readonly { value: PreferencesSection; label: string }[] = [
  { value: 'appearance', label: 'Appearance' },
  { value: 'editor', label: 'Editor' },
  { value: 'plugins', label: 'Plugins' },
];

const THEMES: readonly { value: NotoTheme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/* The numbers are in the hints rather than the labels: the labels are what
   the reader chooses between, the numbers are how the choice is kept honest. */
const WIDTHS: readonly { value: WidthModeV1; label: string; hint: string }[] = [
  { value: 'default', label: 'Default', hint: 'A reading column, up to 860px.' },
  { value: 'wide', label: 'Wide', hint: '78% of the canvas, between 1000 and 1180px.' },
  { value: 'full', label: 'Full', hint: 'Everything beside the rail, up to 1680px.' },
];

/**
 * A number you can drag or nudge, showing its value in its own units.
 *
 * A slider alone hides the number, and a number field alone makes finding a
 * comfortable line height an exercise in typing and re-typing. Both, with the
 * value between them, so coarse search and exact setting each have the control
 * they want.
 */
function Slider({ label, hint, setting, value, format, onChange, testId }: {
  label: string;
  hint?: string;
  setting: NotoNumericSetting;
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  testId: string;
}) {
  const range = SETTING_RANGES[setting];
  return (
    <div className="pref-row pref-slider-row">
      <span className="pref-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <span className="pref-slider">
        <output className="pref-value">{format(value)}</output>
        <input
          type="range"
          data-testid={testId}
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </span>
    </div>
  );
}

/**
 * The custom stylesheet's path.
 *
 * A path typed or pasted, not a file picker: a theme is something you keep
 * open in an editor and reload, and a picker makes you find it again every
 * time. The path is committed on blur or Enter rather than per keystroke, so a
 * half-typed path is never written and never reported as unreadable.
 */
function ThemeFile({ settings, onChange, problem, onReload }: {
  settings: NotoSettingsV1;
  onChange: (patch: Partial<NotoSettingsV1>) => void;
  problem: string;
  onReload: () => void;
}) {
  const [draft, setDraft] = useState(settings.customCssPath);
  useEffect(() => { setDraft(settings.customCssPath); }, [settings.customCssPath]);
  const commit = () => {
    const next = draft.trim();
    if (next !== settings.customCssPath) onChange({ customCssPath: next });
  };
  return (
    <div className="pref-row pref-stack">
      <span className="pref-label">
        Custom stylesheet
        <small>An absolute path to a CSS file. It wins over the theme, so <code>:root &#123; --accent: … &#125;</code> is enough to retheme. Leave empty for none.</small>
      </span>
      <span className="pref-file">
        <input
          type="text"
          spellCheck={false}
          data-testid="setting-custom-css"
          placeholder="/Users/you/noto-theme.css"
          value={draft}
          aria-label="Custom stylesheet path"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }}
        />
        <button type="button" className="pref-inline-action" data-testid="reload-custom-css"
          disabled={!settings.customCssPath} onClick={onReload}>Reload</button>
      </span>
      {problem && <p className="pref-problem" role="status">{problem}</p>}
    </div>
  );
}

function Choices<T extends string>({ label, hint, options, value, onPick, testPrefix }: {
  label: string;
  hint?: string;
  options: readonly { value: T; label: string; hint?: string }[];
  value: T;
  onPick: (value: T) => void;
  testPrefix: string;
}) {
  return (
    <div className="pref-row">
      <span className="pref-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <div className="pref-segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            title={option.hint}
            data-testid={`${testPrefix}-${option.value}`}
            className={value === option.value ? 'pref-segment is-on' : 'pref-segment'}
            onClick={() => onPick(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Switch({ label, hint, checked, onChange, testId }: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  testId: string;
}) {
  return (
    <label className="pref-row pref-switch">
      <span className="pref-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        data-testid={testId}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="pref-track" aria-hidden="true" />
    </label>
  );
}

export function Preferences({
  open, section, onSection, settings, onChange, onClose, plugins, themeProblem, onReloadCss,
}: PreferencesProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => closeRef.current?.focus({ preventScroll: true }));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="pref-scrim" data-testid="settings-scrim" onClick={onClose}>
      <section
        className="pref-dialog"
        data-testid="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
        // The dialog swallows clicks so only the surrounding scrim closes it.
        onClick={(event) => event.stopPropagation()}
      >
        <nav className="pref-sections" aria-label="Preferences sections">
          <span className="pref-title">Preferences</span>
          {SECTIONS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-current={section === entry.value ? 'true' : undefined}
              className={section === entry.value ? 'pref-section is-current' : 'pref-section'}
              data-testid={`pref-${entry.value}`}
              onClick={() => onSection(entry.value)}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="pref-body">
          <header className="pref-body-header">
            <h2>{SECTIONS.find((entry) => entry.value === section)?.label}</h2>
            <button ref={closeRef} type="button" className="pref-close"
              data-testid="settings-close" aria-label="Close preferences"
              onClick={onClose}>Done</button>
          </header>

          <div className="pref-content">
            {section === 'appearance' && (
              <>
                <Choices label="Theme" options={THEMES} value={settings.theme}
                  onPick={(value) => onChange({ theme: value })} testPrefix="theme" />
                <Slider label="Text size" setting="fontSize" value={settings.fontSize}
                  format={(value) => `${value} px`} testId="setting-font-size"
                  onChange={(value) => onChange({ fontSize: value })} />
                <Slider label="Line height" setting="lineHeight" value={settings.lineHeight}
                  format={(value) => value.toFixed(2)} testId="setting-line-height"
                  onChange={(value) => onChange({ lineHeight: Number(value.toFixed(2)) })} />
                <Choices label="Page width" hint="Cmd+] and Cmd+[ step through these."
                  options={WIDTHS} value={settings.widthMode}
                  onPick={(value) => onChange({ widthMode: value })} testPrefix="width" />
                <Switch
                  label="Open the rail at launch"
                  hint="Start with the file tree showing."
                  checked={settings.sidebarOnLaunch}
                  onChange={(value) => onChange({ sidebarOnLaunch: value })}
                  testId="setting-sidebar-launch"
                />
                <ThemeFile settings={settings} onChange={onChange}
                  problem={themeProblem} onReload={onReloadCss} />
              </>
            )}

            {section === 'editor' && (
              <>
                <Switch
                  label="Smart typography"
                  hint="Turn quotes and dashes into their typographic forms as you type."
                  checked={settings.smartTypography}
                  onChange={(value) => onChange({ smartTypography: value })}
                  testId="setting-smart-typography"
                />
                <Switch
                  label="Check spelling"
                  checked={settings.spellCheck}
                  onChange={(value) => onChange({ spellCheck: value })}
                  testId="setting-spell-check"
                />
                <Switch
                  label="Focus mode"
                  hint="Everything but the block you are writing recedes."
                  checked={settings.focusMode}
                  onChange={(value) => onChange({ focusMode: value })}
                  testId="setting-focus-mode"
                />
                <Switch
                  label="Typewriter mode"
                  hint="The line you are writing stays at the middle of the window and the page moves under it."
                  checked={settings.typewriterMode}
                  onChange={(value) => onChange({ typewriterMode: value })}
                  testId="setting-typewriter-mode"
                />
                <Switch
                  label="Line numbers in code blocks"
                  hint="The gutter is as wide as each block's own line count."
                  checked={settings.codeLineNumbers}
                  onChange={(value) => onChange({ codeLineNumbers: value })}
                  testId="setting-code-line-numbers"
                />
                <Switch
                  label="Load images from the web"
                  hint="Every web image in a note is a request to its server. Off shows the image's name in its place. Images in the open folder always show."
                  checked={settings.remoteImages}
                  onChange={(value) => onChange({ remoteImages: value })}
                  testId="setting-remote-images"
                />
                <Switch
                  label="Save automatically"
                  hint="Save on a timer after typing stops. A save is still refused if the file changed underneath it."
                  checked={settings.autoSave}
                  onChange={(value) => onChange({ autoSave: value })}
                  testId="setting-auto-save"
                />
                {settings.autoSave && (
                  <Slider label="Save after" setting="autoSaveDelayMs" value={settings.autoSaveDelayMs}
                    format={(value) => `${(value / 1000).toFixed(1)} s`} testId="setting-auto-save-delay"
                    onChange={(value) => onChange({ autoSaveDelayMs: Math.round(value) })} />
                )}
              </>
            )}

            {section === 'plugins' && plugins}
          </div>

          <p className="pref-note">Changes apply immediately and are remembered.</p>
        </div>
      </section>
    </div>
  );
}
