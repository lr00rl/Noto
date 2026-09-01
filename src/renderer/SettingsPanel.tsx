/**
 * The settings sheet.
 *
 * Every control writes immediately rather than collecting changes behind a Save
 * button. A preferences dialog with an OK button asks the user to predict what
 * a setting does; applying it at once lets them see it and change their mind,
 * which is the whole reason these are visible settings and not a config file.
 */

import { useEffect, useRef } from 'react';
import type { NotoMeasure, NotoSettingsV1, NotoTheme } from '../shared/settings/v1/contracts';

export interface SettingsPanelProps {
  readonly open: boolean;
  readonly settings: NotoSettingsV1;
  readonly onChange: (patch: Partial<NotoSettingsV1>) => void;
  readonly onClose: () => void;
}

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

export function SettingsPanel({ open, settings, onChange, onClose }: SettingsPanelProps) {
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
    <div className="settings-scrim" data-testid="settings-scrim" onClick={onClose}>
      <section
        className="settings-panel"
        data-testid="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        // The sheet swallows clicks so only the surrounding scrim closes it.
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>Settings</h2>
          <button ref={closeRef} type="button" className="settings-close"
            data-testid="settings-close" onClick={onClose}>Done</button>
        </header>

        <fieldset className="settings-group">
          <legend>Appearance</legend>
          <div className="settings-choices" role="radiogroup" aria-label="Theme">
            {THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={settings.theme === option.value}
                data-testid={`theme-${option.value}`}
                className={settings.theme === option.value ? 'settings-choice is-on' : 'settings-choice'}
                onClick={() => onChange({ theme: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="settings-group">
          <legend>Line width</legend>
          <div className="settings-choices" role="radiogroup" aria-label="Line width">
            {MEASURES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={settings.measure === option.value}
                title={option.hint}
                data-testid={`measure-${option.value}`}
                className={settings.measure === option.value ? 'settings-choice is-on' : 'settings-choice'}
                onClick={() => onChange({ measure: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="settings-group">
          <legend>Editing</legend>
          <label className="settings-switch">
            <input
              type="checkbox"
              data-testid="setting-smart-typography"
              checked={settings.smartTypography}
              onChange={(event) => onChange({ smartTypography: event.target.checked })}
            />
            <span>
              Smart typography
              <small>Turn quotes and dashes into their typographic forms as you type.</small>
            </span>
          </label>

          <label className="settings-switch">
            <input
              type="checkbox"
              data-testid="setting-spell-check"
              checked={settings.spellCheck}
              onChange={(event) => onChange({ spellCheck: event.target.checked })}
            />
            <span>Check spelling</span>
          </label>

          <label className="settings-switch">
            <input
              type="checkbox"
              data-testid="setting-sidebar-launch"
              checked={settings.sidebarOnLaunch}
              onChange={(event) => onChange({ sidebarOnLaunch: event.target.checked })}
            />
            <span>Show the workspace tree at launch</span>
          </label>
        </fieldset>

        <p className="settings-note">Changes apply immediately and are remembered.</p>
      </section>
    </div>
  );
}
