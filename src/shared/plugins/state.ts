import { hasExactKeys, isRecord } from '../ipc/validate';
import type { PluginCatalog } from './catalog';

export const LOCAL_PLUGIN_STATE_SCHEMA_VERSION = 1 as const;

export interface LocalPluginStateEntry {
  desiredEnabled: boolean;
  settings: Record<string, boolean>;
}

export interface LocalPluginState {
  schemaVersion: typeof LOCAL_PLUGIN_STATE_SCHEMA_VERSION;
  plugins: Record<string, LocalPluginStateEntry>;
}

export function createDefaultLocalPluginState(catalog: PluginCatalog): LocalPluginState {
  return {
    schemaVersion: LOCAL_PLUGIN_STATE_SCHEMA_VERSION,
    plugins: Object.fromEntries(catalog.plugins.map((manifest) => [
      manifest.id,
      {
        desiredEnabled: false,
        settings: Object.fromEntries(manifest.settings.map((setting) => [setting.key, setting.default])),
      },
    ])),
  };
}

export function cloneLocalPluginState(state: LocalPluginState): LocalPluginState {
  return {
    schemaVersion: LOCAL_PLUGIN_STATE_SCHEMA_VERSION,
    plugins: Object.fromEntries(Object.entries(state.plugins).map(([id, plugin]) => [
      id,
      {
        desiredEnabled: plugin.desiredEnabled,
        settings: { ...plugin.settings },
      },
    ])),
  };
}

export function validateLocalPluginState(
  value: unknown,
  catalog: PluginCatalog,
): value is LocalPluginState {
  if (!isRecord(value)
    || !hasExactKeys(value, ['schemaVersion', 'plugins'])
    || value.schemaVersion !== LOCAL_PLUGIN_STATE_SCHEMA_VERSION
    || !isRecord(value.plugins)) return false;

  const plugins = value.plugins;
  const pluginIds = catalog.plugins.map((manifest) => manifest.id);
  if (!hasExactKeys(plugins, pluginIds)) return false;

  return catalog.plugins.every((manifest) => {
    const plugin = plugins[manifest.id];
    if (!isRecord(plugin)
      || !hasExactKeys(plugin, ['desiredEnabled', 'settings'])
      || typeof plugin.desiredEnabled !== 'boolean'
      || !isRecord(plugin.settings)) return false;
    const settings = plugin.settings;
    const settingKeys = manifest.settings.map((setting) => setting.key);
    return hasExactKeys(settings, settingKeys)
      && settingKeys.every((key) => typeof settings[key] === 'boolean');
  });
}

export function parseLocalPluginState(value: unknown, catalog: PluginCatalog): LocalPluginState {
  if (!isRecord(value)
    || !hasExactKeys(value, ['schemaVersion', 'plugins'])
    || value.schemaVersion !== LOCAL_PLUGIN_STATE_SCHEMA_VERSION
    || !isRecord(value.plugins)) throw new Error('LOCAL_PLUGIN_STATE_INVALID');

  const pluginIds = new Set(catalog.plugins.map((manifest) => manifest.id));
  if (Object.keys(value.plugins).some((pluginId) => !pluginIds.has(pluginId))) {
    throw new Error('LOCAL_PLUGIN_STATE_INVALID');
  }

  const normalized = createDefaultLocalPluginState(catalog);
  for (const manifest of catalog.plugins) {
    const candidate = value.plugins[manifest.id];
    if (candidate === undefined) continue;
    if (!isRecord(candidate)
      || !hasExactKeys(candidate, ['desiredEnabled', 'settings'])
      || typeof candidate.desiredEnabled !== 'boolean'
      || !isRecord(candidate.settings)) throw new Error('LOCAL_PLUGIN_STATE_INVALID');

    const settings = candidate.settings;
    const settingKeys = new Set(manifest.settings.map((setting) => setting.key));
    if (Object.keys(settings).some((key) => !settingKeys.has(key))
      || Object.values(settings).some((setting) => typeof setting !== 'boolean')) {
      throw new Error('LOCAL_PLUGIN_STATE_INVALID');
    }

    normalized.plugins[manifest.id] = {
      desiredEnabled: candidate.desiredEnabled,
      settings: Object.fromEntries(manifest.settings.map((setting) => {
        const persisted = settings[setting.key];
        return [setting.key, typeof persisted === 'boolean' ? persisted : setting.default];
      })),
    };
  }
  return normalized;
}
