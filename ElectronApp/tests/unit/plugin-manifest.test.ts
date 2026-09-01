import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  filesystemProofManifest,
  rendererProofManifest,
} from '../../src/shared/plugins/proof-manifests';
import { createPluginCatalog, validatePluginCatalog } from '../../src/shared/plugins/catalog';
import { parsePluginManifest, validatePluginManifest } from '../../src/shared/plugins/manifest';

describe('schemaVersion 2 bundled plugin manifests', () => {
  it('declares renderer activation, lifecycle, and bounded surfaces', async () => {
    const resource = JSON.parse(await readFile(
      new URL('../../resources/plugins/renderer-proof/manifest.json', import.meta.url),
      'utf8',
    ));
    expect(validatePluginManifest(resource)).toBe(true);
    expect(resource).toEqual(rendererProofManifest);
    expect(resource.schemaVersion).toBe(2);
    expect(resource.activation).toEqual({
      startup: true,
      events: ['editor.ready'],
      hotkeys: ['Mod+Shift+J'],
    });
    expect(resource.capabilities).toEqual(['editor.decorate']);
    expect(resource.lifecycle).toEqual(['activate', 'deactivate']);
    expect(resource.commands).toHaveLength(1);
    expect(resource.settings).toHaveLength(1);
    expect(resource.hotkeys).toHaveLength(1);
    expect(resource.uiExtensions).toContain('semantic-focus-status');
  });

  it('keeps filesystem capability isolated without broadening renderer capability', async () => {
    const resource = JSON.parse(await readFile(
      new URL('../../resources/plugins/filesystem-proof/manifest.json', import.meta.url),
      'utf8',
    ));
    expect(validatePluginManifest(resource)).toBe(true);
    expect(resource).toEqual(filesystemProofManifest);
    expect(resource.schemaVersion).toBe(2);
    expect(resource.runtime).toBe('isolated-service');
    expect(resource.capabilities).toEqual(['filesystem.read']);
    expect(resource.editorExtensions).toEqual([]);
  });

  it('rejects v1, unknown fields, duplicate declarations, and invalid references', () => {
    expect(validatePluginManifest({ ...rendererProofManifest, schemaVersion: 1 })).toBe(false);
    expect(() => parsePluginManifest({ ...rendererProofManifest, schemaVersion: 1 }))
      .toThrow('PLUGIN_MANIFEST_VERSION_UNSUPPORTED');
    expect(validatePluginManifest({ ...rendererProofManifest, arbitraryCode: true })).toBe(false);
    expect(validatePluginManifest({
      ...rendererProofManifest,
      activation: { ...rendererProofManifest.activation, remote: true },
    })).toBe(false);
    expect(validatePluginManifest({
      ...rendererProofManifest,
      activation: {
        ...rendererProofManifest.activation,
        events: ['editor.ready', 'editor.ready'],
      },
    })).toBe(false);
    expect(validatePluginManifest({
      ...rendererProofManifest,
      commands: [...rendererProofManifest.commands, rendererProofManifest.commands[0]],
    })).toBe(false);
    expect(validatePluginManifest({
      ...rendererProofManifest,
      settings: [...rendererProofManifest.settings, rendererProofManifest.settings[0]],
    })).toBe(false);
    expect(validatePluginManifest({
      ...rendererProofManifest,
      hotkeys: [{ command: 'missing.command', keys: 'Mod+Shift+J' }],
    })).toBe(false);
    expect(validatePluginManifest({
      ...rendererProofManifest,
      activation: { ...rendererProofManifest.activation, hotkeys: ['Mod+Shift+K'] },
    })).toBe(false);
  });

  it('rejects incompatible runtimes, capabilities, and service editor extensions', () => {
    expect(validatePluginManifest({ ...rendererProofManifest, runtime: 'ambient-node' })).toBe(false);
    expect(validatePluginManifest({
      ...rendererProofManifest,
      capabilities: ['filesystem.read'],
    })).toBe(false);
    expect(validatePluginManifest({
      ...filesystemProofManifest,
      capabilities: ['editor.decorate'],
    })).toBe(false);
    expect(validatePluginManifest({
      ...filesystemProofManifest,
      editorExtensions: ['unsafe-editor-access'],
    })).toBe(false);
  });

  it('accepts bounded SemVer 2.0 prerelease and build forms', () => {
    for (const version of [
      '1.0.0',
      '1.0.0-beta.1',
      '1.0.0+build.7',
      '1.0.0-beta.1+build.7',
      '0.0.0-0',
      '1.0.0+001',
      `1.0.0-${'a'.repeat(64)}`,
    ]) {
      expect(validatePluginManifest({ ...rendererProofManifest, version }), version).toBe(true);
    }

    const maximumLengthVersion = `1.0.0+${[
      'a'.repeat(64),
      'b'.repeat(64),
      'c'.repeat(64),
      'd'.repeat(55),
    ].join('.')}`;
    expect(maximumLengthVersion).toHaveLength(256);
    expect(validatePluginManifest({
      ...rendererProofManifest,
      version: maximumLengthVersion,
    })).toBe(true);
  });

  it('rejects invalid or overlong SemVer 2.0 forms', () => {
    for (const version of [
      '01.2.3',
      '1.02.3',
      '1.2.03',
      '1.0.0-',
      '1.0.0-alpha..1',
      '1.0.0-01',
      '1.0.0+',
      '1.0.0+build..7',
      '1.0.0-beta_1',
      '1.0.0+build/7',
      '1.0.0-β',
      `1.0.0-${'a'.repeat(65)}`,
      `1.0.0+${'a'.repeat(65)}`,
    ]) {
      expect(validatePluginManifest({ ...rendererProofManifest, version }), version).toBe(false);
    }

    const overlongVersion = `1.0.0+${[
      'a'.repeat(64),
      'b'.repeat(64),
      'c'.repeat(64),
      'd'.repeat(56),
    ].join('.')}`;
    expect(overlongVersion).toHaveLength(257);
    expect(validatePluginManifest({
      ...rendererProofManifest,
      version: overlongVersion,
    })).toBe(false);
  });

  it('rejects duplicate bundled hotkeys deterministically', () => {
    const conflictingManifest = {
      ...rendererProofManifest,
      id: 'dev.lr00rl.noto.renderer-proof-conflict',
      name: 'Semantic Focus Conflict',
    };
    const conflictingCatalog = {
      schemaVersion: 1 as const,
      plugins: [rendererProofManifest, conflictingManifest],
    };

    expect(validatePluginCatalog(conflictingCatalog)).toBe(false);
    expect(() => createPluginCatalog(conflictingCatalog.plugins))
      .toThrow('PLUGIN_CATALOG_HOTKEY_CONFLICT: Mod+Shift+J');
  });
});
