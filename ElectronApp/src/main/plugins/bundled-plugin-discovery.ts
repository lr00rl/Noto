import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createPluginCatalog, type PluginCatalog } from '../../shared/plugins/catalog';
import { parsePluginManifest } from '../../shared/plugins/manifest';

const MAX_BUNDLED_PLUGINS = 64;
const MAX_MANIFEST_BYTES = 256 * 1024;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type BundledPluginDiscoveryErrorCode =
  | 'PLUGIN_DISCOVERY_UNAVAILABLE'
  | 'PLUGIN_DISCOVERY_UNSAFE'
  | 'PLUGIN_DISCOVERY_LIMIT_EXCEEDED'
  | 'PLUGIN_DISCOVERY_MANIFEST_TOO_LARGE'
  | 'PLUGIN_DISCOVERY_MANIFEST_INVALID'
  | 'PLUGIN_DISCOVERY_CATALOG_INVALID';

export class BundledPluginDiscoveryError extends Error {
  constructor(readonly code: BundledPluginDiscoveryErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = 'BundledPluginDiscoveryError';
  }
}

export function bundledPluginResourceRoot(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
}): string {
  return options.isPackaged
    ? path.join(options.resourcesPath, 'resources', 'plugins')
    : path.join(options.appPath, 'resources', 'plugins');
}

export function isContainedPluginResourcePath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function discoverBundledPluginCatalog(root: string): Promise<PluginCatalog> {
  let rootStats;
  let acceptedRoot: string;
  try {
    rootStats = await lstat(root);
    acceptedRoot = await realpath(root);
  } catch (cause) {
    throw new BundledPluginDiscoveryError('PLUGIN_DISCOVERY_UNAVAILABLE', { cause });
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory() || !path.isAbsolute(acceptedRoot)) {
    throw new BundledPluginDiscoveryError('PLUGIN_DISCOVERY_UNSAFE');
  }

  let entries;
  try {
    entries = await readdir(acceptedRoot, { withFileTypes: true });
  } catch (cause) {
    throw new BundledPluginDiscoveryError('PLUGIN_DISCOVERY_UNAVAILABLE', { cause });
  }
  if (entries.length === 0) {
    throw new BundledPluginDiscoveryError('PLUGIN_DISCOVERY_UNAVAILABLE');
  }
  if (entries.length > MAX_BUNDLED_PLUGINS) {
    throw new BundledPluginDiscoveryError('PLUGIN_DISCOVERY_LIMIT_EXCEEDED');
  }
  entries.sort((left, right) => compareCodeUnits(left.name, right.name));

  const manifests = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory() || entry.name === '.' || entry.name === '..') {
      throw new BundledPluginDiscoveryError('PLUGIN_DISCOVERY_UNSAFE');
    }
    const pluginDirectory = path.join(acceptedRoot, entry.name);
    let pluginStats;
    let acceptedPluginDirectory: string;
    try {
      pluginStats = await lstat(pluginDirectory);
      acceptedPluginDirectory = await realpath(pluginDirectory);
    } catch (cause) {
      throw new BundledPluginDiscoveryError('PLUGIN_DISCOVERY_UNSAFE', { cause });
    }
    if (pluginStats.isSymbolicLink() || !pluginStats.isDirectory()
      || !isContainedPluginResourcePath(acceptedRoot, acceptedPluginDirectory)) {
      throw new BundledPluginDiscoveryError('PLUGIN_DISCOVERY_UNSAFE');
    }

    const manifestPath = path.join(acceptedPluginDirectory, 'manifest.json');
    let handle;
    try {
      handle = await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > MAX_MANIFEST_BYTES) {
        throw new BundledPluginDiscoveryError(
          stats.size > MAX_MANIFEST_BYTES
            ? 'PLUGIN_DISCOVERY_MANIFEST_TOO_LARGE'
            : 'PLUGIN_DISCOVERY_UNSAFE',
        );
      }
      const acceptedManifestPath = await realpath(manifestPath);
      if (!isContainedPluginResourcePath(acceptedPluginDirectory, acceptedManifestPath)) {
        throw new BundledPluginDiscoveryError('PLUGIN_DISCOVERY_UNSAFE');
      }
      const source = await handle.readFile('utf8');
      manifests.push(parsePluginManifest(JSON.parse(source)));
    } catch (cause) {
      if (cause instanceof BundledPluginDiscoveryError) throw cause;
      throw new BundledPluginDiscoveryError('PLUGIN_DISCOVERY_MANIFEST_INVALID', { cause });
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  manifests.sort((left, right) => compareCodeUnits(left.id, right.id));
  try {
    return createPluginCatalog(manifests);
  } catch (cause) {
    throw new BundledPluginDiscoveryError('PLUGIN_DISCOVERY_CATALOG_INVALID', { cause });
  }
}
