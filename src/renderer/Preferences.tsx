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

import { useEffect, useRef, type ReactNode } from 'react';
import type { NotoMeasure, NotoSettingsV1, NotoTheme } from '../shared/settings/v1/contracts';

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

const MEASURES: readonly { value: NotoMeasure; label: string; hint: string }[] = [
  { value: 'narrow', label: 'Narrow', hint: 'About 60 characters' },
  { value: 'medium', label: 'Medium', hint: 'About 75 characters' },
  { value: 'wide', label: 'Wide', hint: 'About 90 characters' },
];

function Choices<T extends string>({ label, options, value, onPick, testPrefix }: {
  label: string;
  options: readonly { value: T; label: string; hint?: string }[];
  value: T;
  onPick: (value: T) => void;
  testPrefix: string;
}) {
  return (
    <div className="pref-row">
      <span className="pref-label">{label}</span>
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
  open, section, onSection, settings, onChange, onClose, plugins,
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
                <Choices label="Line width" options={MEASURES} value={settings.measure}
                  onPick={(value) => onChange({ measure: value })} testPrefix="measure" />
                <Switch
                  label="Open the rail at launch"
                  hint="Start with the file tree showing."
                  checked={settings.sidebarOnLaunch}
                  onChange={(value) => onChange({ sidebarOnLaunch: value })}
                  testId="setting-sidebar-launch"
                />
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
