import { hasExactKeys, isRecord } from '../ipc/validate';
import { validatePluginManifest, type PluginManifest } from './manifest';

export const PLUGIN_CATALOG_SCHEMA_VERSION = 1 as const;

export interface PluginCatalog {
  schemaVersion: typeof PLUGIN_CATALOG_SCHEMA_VERSION;
  plugins: PluginManifest[];
}

export function validatePluginCatalog(value: unknown): value is PluginCatalog {
  if (!isRecord(value)
    || !hasExactKeys(value, ['schemaVersion', 'plugins'])
    || value.schemaVersion !== PLUGIN_CATALOG_SCHEMA_VERSION
    || !Array.isArray(value.plugins)
    || value.plugins.length === 0
    || value.plugins.length > 64
    || !value.plugins.every(validatePluginManifest)) return false;

  const plugins = value.plugins as PluginManifest[];
  return new Set(plugins.map((manifest) => manifest.id)).size === plugins.length
    && duplicateHotkey(plugins) === null;
}

export function createPluginCatalog(manifests: readonly PluginManifest[]): PluginCatalog {
  const catalog: PluginCatalog = {
    schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
    plugins: manifests.map((manifest) => ({
      ...manifest,
      activation: {
        startup: manifest.activation.startup,
        events: [...manifest.activation.events],
        hotkeys: [...manifest.activation.hotkeys],
      },
      capabilities: [...manifest.capabilities],
      lifecycle: [...manifest.lifecycle],
      commands: manifest.commands.map((command) => ({ ...command })),
      settings: manifest.settings.map((setting) => ({ ...setting })),
      hotkeys: manifest.hotkeys.map((hotkey) => ({ ...hotkey })),
      editorExtensions: [...manifest.editorExtensions],
      uiExtensions: [...manifest.uiExtensions],
    })),
  };
  const hotkeyConflict = duplicateHotkey(catalog.plugins);
  if (hotkeyConflict) throw new Error(`PLUGIN_CATALOG_HOTKEY_CONFLICT: ${hotkeyConflict}`);
  if (!validatePluginCatalog(catalog)) throw new Error('PLUGIN_CATALOG_INVALID');
  return catalog;
}

function duplicateHotkey(manifests: readonly PluginManifest[]): string | null {
  const seen = new Set<string>();
  for (const manifest of manifests) {
    for (const hotkey of manifest.hotkeys) {
      if (seen.has(hotkey.keys)) return hotkey.keys;
      seen.add(hotkey.keys);
    }
  }
  return null;
}
