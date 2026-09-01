/**
 * Turning a keyboard event into a manifest hotkey string.
 *
 * The manifest is the source of truth for which chords exist, so the shell
 * matches against the declared set instead of hard coding bindings. Main still
 * decides whether the plugin that declared it may run.
 */

import type { PluginManifest } from '../../shared/plugins/manifest';

/** The subset of a keyboard event this needs, so it is testable without a DOM. */
export interface HotkeyEvent {
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * Map a `KeyboardEvent.code` to the key name a manifest uses.
 *
 * `code` rather than `key`, because `key` changes with the keyboard layout and
 * with modifiers held: Shift+2 reports `"` on some layouts. A binding should
 * mean the same physical chord everywhere.
 */
function manifestKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Escape)$/.test(code)) {
    return code;
  }
  if (code === 'Space') return 'Space';
  return null;
}

/** The manifest chord an event represents, in the canonical modifier order. */
export function chordFor(event: HotkeyEvent): string | null {
  const key = manifestKey(event.code);
  if (!key) return null;
  // `Mod` is Command on macOS and Control elsewhere, which is why the event's
  // meta and control flags collapse into one token here.
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (parts.length === 0) return null;
  parts.push(key);
  return parts.join('+');
}

/** Every hotkey the given manifests declare. */
export function declaredHotkeys(manifests: readonly PluginManifest[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const manifest of manifests) {
    for (const hotkey of manifest.hotkeys) keys.add(hotkey.keys);
  }
  return keys;
}

/**
 * The declared hotkey an event matches, or null.
 *
 * Returning the string rather than dispatching keeps this pure and lets the
 * shell decide what to do with it.
 */
export function matchHotkey(event: HotkeyEvent, declared: ReadonlySet<string>): string | null {
  const chord = chordFor(event);
  return chord && declared.has(chord) ? chord : null;
}
