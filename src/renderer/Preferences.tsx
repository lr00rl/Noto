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
  type ImageDestinationV1,
  type NotoNumericSetting,
  type NotoSettingsV1,
  type NotoTheme,
  type WidthModeV1,
} from '../shared/settings/v1/contracts';

export type PreferencesSection = 'appearance' | 'editor' | 'markdown' | 'images' | 'plugins';

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

/**
 * One glyph per section, drawn rather than named.
 *
 * A column of words is a list; a column of words with marks beside them is a
 * place, and the eye finds the row it wants without reading. Typora's own
 * preferences do this and it is most of why its panel reads as settled.
 */
function SectionGlyph({ name }: { name: PreferencesSection }) {
  const paths: Record<PreferencesSection, string> = {
    appearance: 'M8 2.5a5.5 5.5 0 1 0 0 11c.7 0 1.2-.5 1.2-1.1 0-.3-.1-.6-.3-.8-.2-.2-.3-.4-.3-.7 0-.6.5-1.1 1.1-1.1h1.3A3.5 3.5 0 0 0 14 6.3C14 4 11.3 2.5 8 2.5Z M5.5 6.5h.01 M8 5h.01 M10.5 6.5h.01',
    editor: 'M2.5 12.5h11 M4 9.8 10.2 3.6a1.4 1.4 0 0 1 2 2L6 11.8l-2.6.6Z',
    markdown: 'M2.5 4.5h11v7h-11z M4.5 10V6.5l2 2 2-2V10 M11 6.5V10 M9.8 8.6 11 10l1.2-1.4',
    images: 'M2.5 3.5h11v9h-11z M2.5 10.2 5.9 7.4l2.4 2 2-1.7 3.2 2.7 M10.4 5.9h.01',
    plugins: 'M6 2.5v2.2a1.3 1.3 0 1 1-2.6 0V2.5 M2.5 6h11v7.5h-11z M2.5 6V3.4h1',
  };
  return (
    <svg className="pref-glyph" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

const SECTIONS: readonly { value: PreferencesSection; label: string; keywords: string }[] = [
  { value: 'appearance', label: 'Appearance', keywords: 'theme dark light text size line height width rail stylesheet css font' },
  { value: 'editor', label: 'Editor', keywords: 'spell check images brackets pairs focus typewriter save autosave line numbers guides' },
  { value: 'markdown', label: 'Markdown', keywords: 'smart quotes dashes ellipsis punctuation typography syntax' },
  { value: 'images', label: 'Images', keywords: 'image picture paste drop screenshot assets folder copy relative path escape url' },
  { value: 'plugins', label: 'Plugins', keywords: 'plugin extension enable disable palette' },
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


/**
 * Where a pasted picture goes.
 *
 * A column rather than a segmented control, and each row shows the reference
 * it would actually write. Four folder rules described in words are four things
 * to guess at; the same four with `./assets/image-2026….png` under them are a
 * choice the reader can make without pasting a picture to find out. The example
 * is the point of this control.
 */
function ImageDestination({ value, custom, onPick }: {
  value: ImageDestinationV1;
  custom: string;
  onPick: (value: ImageDestinationV1) => void;
}) {
  const trimmed = custom.trim() === '' ? './images' : custom.trim();
  const options: readonly { value: ImageDestinationV1; label: string; example: string }[] = [
    { value: 'assets', label: 'An assets folder beside the note', example: './assets/image-20260902.png' },
    { value: 'note-assets', label: 'A folder named after the note', example: './My Note.assets/image-20260902.png' },
    { value: 'folder', label: 'Beside the note itself', example: './image-20260902.png' },
    { value: 'custom', label: 'A folder I choose', example: `${trimmed.replace(/\/+$/, '')}/image-20260902.png` },
  ];
  return (
    <div className="pref-row pref-stack">
      <span className="pref-label">
        When a picture is pasted or dropped
        <small>The file is copied into the vault and the note refers to it by a relative path, so the note and its pictures travel together.</small>
      </span>
      <div className="pref-cards" role="radiogroup" aria-label="Where a pasted picture is written">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            data-testid={`image-destination-${option.value}`}
            className={value === option.value ? 'pref-card is-on' : 'pref-card'}
            onClick={() => onPick(option.value)}
          >
            <span className="pref-card-mark" aria-hidden="true" />
            <span className="pref-card-text">
              {option.label}
              <code>{option.example}</code>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The folder the `custom` rule writes into. Relative to the note unless absolute. */
function ImageFolder({ settings, onChange }: {
  settings: NotoSettingsV1;
  onChange: (patch: Partial<NotoSettingsV1>) => void;
}) {
  const [draft, setDraft] = useState(settings.imageCustomFolder);
  useEffect(() => { setDraft(settings.imageCustomFolder); }, [settings.imageCustomFolder]);
  const commit = () => {
    const next = draft.trim();
    if (next !== settings.imageCustomFolder) onChange({ imageCustomFolder: next });
  };
  return (
    <div className="pref-row pref-stack">
      <span className="pref-label">
        The folder
        <small>Relative to the note, or an absolute path. It has to be inside the open folder: a picture written outside it is one the app then refuses to show.</small>
      </span>
      <span className="pref-file">
        <input
          type="text"
          spellCheck={false}
          data-testid="setting-image-folder"
          placeholder="./images"
          value={draft}
          aria-label="Image folder"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }}
        />
      </span>
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
  const dialogRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');

  /* Matched on the section's own words as well as its name, so "dark" finds
     Appearance and "brackets" finds Editor. */
  const matching = SECTIONS.filter((entry) => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return true;
    return entry.label.toLowerCase().includes(needle) || entry.keywords.includes(needle);
  });

  /*
   * The dialog takes the focus, not the button that closes it.
   *
   * Focus has to leave the document behind the scrim, or Escape and Tab go to
   * the editor. Putting it on Done drew a focus ring around the loudest thing
   * in the panel the moment it opened, so the eye landed on a button before
   * the settings. The dialog itself is not a control, so it takes focus
   * without drawing anything, and the first Tab still reaches Done.
   */
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => dialogRef.current?.focus({ preventScroll: true }));
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
        ref={dialogRef}
        tabIndex={-1}
        className="pref-dialog"
        data-testid="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
        // The dialog swallows clicks so only the surrounding scrim closes it.
        onClick={(event) => event.stopPropagation()}
      >
        <nav className="pref-sections" aria-label="Preferences sections">
          {/* Typora puts a search over its sections and it earns the room: a
              reader who knows the name of a setting should not have to know
              which pane somebody filed it under. */}
          <label className="pref-search">
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none"
              stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <circle cx="7" cy="7" r="4.2" /><path d="m10.2 10.2 3 3" />
            </svg>
            <input
              type="search"
              value={query}
              placeholder="Search"
              spellCheck={false}
              data-testid="pref-search"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {matching.map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-current={section === entry.value ? 'true' : undefined}
              className={section === entry.value ? 'pref-section is-current' : 'pref-section'}
              data-testid={`pref-${entry.value}`}
              onClick={() => onSection(entry.value)}
            >
              <SectionGlyph name={entry.value} />
              {entry.label}
            </button>
          ))}
          {matching.length === 0 && <p className="pref-no-match">Nothing by that name.</p>}
        </nav>

        <div className="pref-body">
          <header className="pref-body-header">
            <h2>{SECTIONS.find((entry) => entry.value === section)?.label}</h2>
            <button type="button" className="pref-close"
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
                <Choices label="Page width" hint="Also on the View menu."
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
                  label="Check spelling"
                  checked={settings.spellCheck}
                  onChange={(value) => onChange({ spellCheck: value })}
                  testId="setting-spell-check"
                />
                <Switch
                  label="Close brackets and quotes"
                  hint="Typing an opening bracket writes its partner. Never inside a word, so an apostrophe stays an apostrophe."
                  checked={settings.autoPair}
                  onChange={(value) => onChange({ autoPair: value })}
                  testId="setting-auto-pair"
                />
                <Switch
                  label="Indent guides in code blocks"
                  hint="A rule at each tab stop of a line's indentation."
                  checked={settings.codeIndentGuides}
                  onChange={(value) => onChange({ codeIndentGuides: value })}
                  testId="setting-code-indent-guides"
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

            {section === 'markdown' && (
              <>
                <p className="pref-group">Substitutions</p>
                <Switch
                  label="Smart quotes"
                  hint="Straight quotes become curled ones as you type."
                  checked={settings.smartQuotes}
                  onChange={(value) => onChange({ smartQuotes: value })}
                  testId="setting-smart-quotes"
                />
                <Switch
                  label="Smart dashes"
                  hint="Two hyphens become an em dash."
                  checked={settings.smartDashes}
                  onChange={(value) => onChange({ smartDashes: value })}
                  testId="setting-smart-dashes"
                />
                <Switch
                  label="Ellipsis"
                  hint="Three full stops become one character."
                  checked={settings.smartEllipsis}
                  onChange={(value) => onChange({ smartEllipsis: value })}
                  testId="setting-smart-ellipsis"
                />
              </>
            )}

            {section === 'images' && (
              <>
                <ImageDestination
                  value={settings.imageDestination}
                  custom={settings.imageCustomFolder}
                  onPick={(value) => onChange({ imageDestination: value })}
                />
                {settings.imageDestination === 'custom' && (
                  <ImageFolder settings={settings} onChange={onChange} />
                )}
                <Switch
                  label="Escape the address"
                  hint="Percent-encode the reference, so a space or a Chinese character in a folder name still resolves. Off writes the name as it is, which other editors read too."
                  checked={settings.imageEscapeUrl}
                  onChange={(value) => onChange({ imageEscapeUrl: value })}
                  testId="setting-image-escape"
                />
                <Switch
                  label="Load images from the web"
                  hint="Off shows a placeholder for a `https://` picture and leaves the note untouched."
                  checked={settings.remoteImages}
                  onChange={(value) => onChange({ remoteImages: value })}
                  testId="setting-remote-images-image-pane"
                />
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
