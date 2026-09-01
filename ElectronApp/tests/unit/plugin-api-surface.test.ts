import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { rendererProofManifest, titleShiftManifest, markdownPaddingManifest } from '../../src/shared/plugins/proof-manifests';
import { validatePluginManifest } from '../../src/shared/plugins/manifest';

/**
 * The plugin API is a promise, so its shape is pinned here.
 *
 * "A stable TypeScript API" only means something if widening it is a deliberate
 * act. This surface has already grown once, when document access was added for
 * the ported plugins, and that was the right call; the point is that the next
 * one should be a decision rather than a side effect of some other change.
 *
 * Each method is listed with the capability that gates it, because a method
 * reaching plugins without a capability is the failure that matters: it would
 * hand every plugin a power its manifest never asked for.
 */
const PORT_METHODS: Readonly<Record<string, string>> = {
  setSemanticFocus: 'editor.decorate',
  getMarkdown: 'editor.read',
  replaceMarkdown: 'editor.transform',
};

async function source(file: string): Promise<string> {
  return readFile(new URL(`../../src/${file}`, import.meta.url), 'utf8');
}

describe('the editor port plugins receive', () => {
  it('exposes exactly the methods that are meant to be public', async () => {
    const port = await source('renderer/editor/noto/NotoEditorPort.ts');
    const declared = [...port.matchAll(/^\s{2}(\w+)\(/gm)].map((match) => match[1]);
    expect(declared.sort()).toEqual(Object.keys(PORT_METHODS).sort());
  });

  it('gates every method on a capability', async () => {
    const host = await source('renderer/plugins/RendererPluginHost.ts');
    for (const [method, capability] of Object.entries(PORT_METHODS)) {
      // The host builds the port from this map, so a method missing from it
      // would be ungated.
      expect(host).toContain(`${method}: '${capability}'`);
    }
  });

  it('refuses a capability the manifest schema does not define', () => {
    const forged = {
      ...titleShiftManifest,
      capabilities: ['editor.read', 'filesystem.write'],
    };
    expect(validatePluginManifest(forged)).toBe(false);
  });

  it('keeps the trusted renderer capabilities to the three that exist', async () => {
    const manifest = await source('shared/plugins/manifest.ts');
    expect(manifest).toContain("['editor.read', 'editor.decorate', 'editor.transform']");
  });
});

describe('the bundled manifests stay valid', () => {
  const manifests = [rendererProofManifest, titleShiftManifest, markdownPaddingManifest];

  it('every one passes the schema it is published under', () => {
    for (const manifest of manifests) {
      expect(validatePluginManifest(manifest)).toBe(true);
    }
  });

  it('declares a capability for every power it uses', () => {
    // A transform plugin rewrites the document, so it must hold both the read
    // and the transform capability. Declaring one without the other would fail
    // at the port rather than at install time, which is far too late.
    for (const manifest of [titleShiftManifest, markdownPaddingManifest]) {
      expect(manifest.capabilities).toContain('editor.read');
      expect(manifest.capabilities).toContain('editor.transform');
    }
  });

  it('does not activate a document transform at startup', () => {
    // A plugin that rewrote the file before the user asked would be editing
    // their document unprompted.
    for (const manifest of [titleShiftManifest, markdownPaddingManifest]) {
      expect(manifest.activation.startup).toBe(false);
    }
  });

  it('binds every declared hotkey to a command it also declares', () => {
    for (const manifest of manifests) {
      const commands = new Set(manifest.commands.map((command) => command.id));
      for (const hotkey of manifest.hotkeys) {
        expect(commands.has(hotkey.command)).toBe(true);
      }
    }
  });
});
