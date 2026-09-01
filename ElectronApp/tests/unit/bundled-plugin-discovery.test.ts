import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bundledPluginResourceRoot,
  discoverBundledPluginCatalog,
  isContainedPluginResourcePath,
} from '../../src/main/plugins/bundled-plugin-discovery';
import {
  filesystemProofManifest,
  rendererProofManifest,
} from '../../src/shared/plugins/proof-manifests';

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'noto-plugin-discovery-'));
  temporaryRoots.push(root);
  return root;
}

async function writeManifest(root: string, directory: string, manifest: unknown): Promise<void> {
  const pluginDirectory = path.join(root, directory);
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(path.join(pluginDirectory, 'manifest.json'), JSON.stringify(manifest));
}

const thirdManifest = {
  ...rendererProofManifest,
  id: 'dev.lr00rl.noto.outline-proof',
  name: 'Outline Proof',
  activation: { startup: false, events: ['editor.ready'], hotkeys: ['Mod+Shift+K'] },
  commands: [{ id: 'outline.toggle', title: 'Toggle outline' }],
  hotkeys: [{ command: 'outline.toggle', keys: 'Mod+Shift+K' }],
};

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('bundled plugin resource discovery', () => {
  it('resolves stable packaged and development resource roots', () => {
    expect(bundledPluginResourceRoot({
      isPackaged: true,
      resourcesPath: '/Applications/Noto.app/Contents/Resources',
      appPath: '/ignored',
    })).toBe('/Applications/Noto.app/Contents/Resources/resources/plugins');
    expect(bundledPluginResourceRoot({
      isPackaged: false,
      resourcesPath: '/ignored',
      appPath: '/work/ElectronApp',
    })).toBe('/work/ElectronApp/resources/plugins');
  });

  it('parses three manifests and returns deterministic id ordering', async () => {
    const root = await temporaryRoot();
    await writeManifest(root, 'z-renderer', rendererProofManifest);
    await writeManifest(root, 'a-filesystem', filesystemProofManifest);
    await writeManifest(root, 'm-outline', thirdManifest);

    const catalog = await discoverBundledPluginCatalog(root);

    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.plugins.map((manifest) => manifest.id)).toEqual([
      filesystemProofManifest.id,
      thirdManifest.id,
      rendererProofManifest.id,
    ]);
  });

  it.each([
    ['malformed JSON', async (root: string) => {
      const directory = path.join(root, 'broken');
      await mkdir(directory);
      await writeFile(path.join(directory, 'manifest.json'), '{');
    }, 'PLUGIN_DISCOVERY_MANIFEST_INVALID'],
    ['unknown schema', async (root: string) => {
      await writeManifest(root, 'broken', { ...rendererProofManifest, schemaVersion: 99 });
    }, 'PLUGIN_DISCOVERY_MANIFEST_INVALID'],
    ['oversized manifest', async (root: string) => {
      const directory = path.join(root, 'large');
      await mkdir(directory);
      await writeFile(path.join(directory, 'manifest.json'), 'x'.repeat(256 * 1024 + 1));
    }, 'PLUGIN_DISCOVERY_MANIFEST_TOO_LARGE'],
    ['non-directory entry', async (root: string) => {
      await writeFile(path.join(root, 'manifest.json'), '{}');
    }, 'PLUGIN_DISCOVERY_UNSAFE'],
    ['duplicate id', async (root: string) => {
      await writeManifest(root, 'one', rendererProofManifest);
      await writeManifest(root, 'two', rendererProofManifest);
    }, 'PLUGIN_DISCOVERY_CATALOG_INVALID'],
    ['hotkey conflict', async (root: string) => {
      await writeManifest(root, 'one', rendererProofManifest);
      await writeManifest(root, 'two', {
        ...thirdManifest,
        activation: { ...thirdManifest.activation, hotkeys: ['Mod+Shift+J'] },
        hotkeys: [{ command: 'outline.toggle', keys: 'Mod+Shift+J' }],
      });
    }, 'PLUGIN_DISCOVERY_CATALOG_INVALID'],
  ] as const)('rejects %s with a bounded path-free error', async (_label, arrange, code) => {
    const root = await temporaryRoot();
    await arrange(root);

    const failure = await discoverBundledPluginCatalog(root).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code, message: code });
    expect(JSON.stringify(failure)).not.toContain(root);
  });

  it('rejects symlinked plugin directories and manifest traversal', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await writeManifest(outside, 'escaped', rendererProofManifest);
    await symlink(path.join(outside, 'escaped'), path.join(root, 'escaped'));

    await expect(discoverBundledPluginCatalog(root)).rejects.toMatchObject({
      code: 'PLUGIN_DISCOVERY_UNSAFE',
    });
    expect(isContainedPluginResourcePath(root, path.join(root, 'plugin'))).toBe(true);
    expect(isContainedPluginResourcePath(root, path.resolve(root, '..', 'escaped'))).toBe(false);
  });

  it('rejects more than 64 resource entries before parsing manifests', async () => {
    const root = await temporaryRoot();
    await Promise.all(Array.from({ length: 65 }, (_, index) => (
      mkdir(path.join(root, `plugin-${String(index).padStart(2, '0')}`))
    )));

    await expect(discoverBundledPluginCatalog(root)).rejects.toMatchObject({
      code: 'PLUGIN_DISCOVERY_LIMIT_EXCEEDED',
    });
  });

  it('keeps checked-in proof manifests equal to discovered resources', async () => {
    const root = new URL('../../resources/plugins/', import.meta.url);
    const catalog = await discoverBundledPluginCatalog(root.pathname);
    const sources = await Promise.all(catalog.plugins.map(async (manifest) => JSON.parse(await readFile(
      // The directory is the last segment of the plugin id, so this keeps
      // working as plugins are added.
      new URL(`${manifest.id.split('.').at(-1)}/manifest.json`, root),
      'utf8',
    ))));
    expect(sources).toEqual(catalog.plugins);
  });
});
