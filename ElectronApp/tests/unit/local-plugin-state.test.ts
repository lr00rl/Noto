import { describe, expect, it } from 'vitest';
import { createPluginCatalog } from '../../src/shared/plugins/catalog';
import {
  filesystemProofManifest,
  rendererProofManifest,
} from '../../src/shared/plugins/proof-manifests';
import {
  createDefaultLocalPluginState,
  parseLocalPluginState,
  validateLocalPluginState,
} from '../../src/shared/plugins/state';

const catalog = createPluginCatalog([rendererProofManifest, filesystemProofManifest]);

describe('exact persisted local plugin state', () => {
  it('fails closed on missing state while retaining declared boolean defaults without grants', () => {
    const state = createDefaultLocalPluginState(catalog);

    expect(state).toEqual({
      schemaVersion: 1,
      plugins: {
        'dev.lr00rl.noto.renderer-proof': {
          desiredEnabled: false,
          settings: { focusEnabled: true },
        },
        'dev.lr00rl.noto.filesystem-proof': {
          desiredEnabled: false,
          settings: {},
        },
      },
    });
    expect(JSON.stringify(state)).not.toMatch(/grant/i);
    expect(validateLocalPluginState(state, catalog)).toBe(true);
  });

  it('default-fills newly bundled plugins and settings without changing existing enable intent', () => {
    const previousCatalog = createPluginCatalog([{
      ...rendererProofManifest,
      settings: [],
    }]);
    const previous = createDefaultLocalPluginState(previousCatalog);
    previous.plugins[rendererProofManifest.id].desiredEnabled = true;

    const evolved = parseLocalPluginState(previous, catalog);

    expect(evolved).toEqual({
      schemaVersion: 1,
      plugins: {
        [rendererProofManifest.id]: {
          desiredEnabled: true,
          settings: { focusEnabled: true },
        },
        [filesystemProofManifest.id]: {
          desiredEnabled: false,
          settings: {},
        },
      },
    });
  });

  it('rejects surplus plugins and settings while accepting only deterministic missing-field evolution', () => {
    const valid = createDefaultLocalPluginState(catalog);
    expect(() => parseLocalPluginState({
      ...valid,
      plugins: {
        ...valid.plugins,
        'dev.lr00rl.noto.unknown': valid.plugins[rendererProofManifest.id],
      },
    }, catalog)).toThrow('LOCAL_PLUGIN_STATE_INVALID');
    expect(() => parseLocalPluginState({
      ...valid,
      plugins: {
        ...valid.plugins,
        [rendererProofManifest.id]: {
          ...valid.plugins[rendererProofManifest.id],
          settings: { focusEnabled: true, newPrivilege: false },
        },
      },
    }, catalog)).toThrow('LOCAL_PLUGIN_STATE_INVALID');
  });

  it('fails closed on schema, plugin, setting, type, missing, and surplus fields', () => {
    const valid = createDefaultLocalPluginState(catalog);
    const renderer = valid.plugins[rendererProofManifest.id];

    expect(validateLocalPluginState({ ...valid, schemaVersion: 2 }, catalog)).toBe(false);
    expect(validateLocalPluginState({ ...valid, grants: [] }, catalog)).toBe(false);
    expect(validateLocalPluginState({
      ...valid,
      plugins: { ...valid.plugins, 'dev.lr00rl.noto.unknown': renderer },
    }, catalog)).toBe(false);
    expect(validateLocalPluginState({
      ...valid,
      plugins: { [rendererProofManifest.id]: renderer },
    }, catalog)).toBe(false);
    expect(validateLocalPluginState({
      ...valid,
      plugins: {
        ...valid.plugins,
        [rendererProofManifest.id]: { ...renderer, active: true },
      },
    }, catalog)).toBe(false);
    expect(validateLocalPluginState({
      ...valid,
      plugins: {
        ...valid.plugins,
        [rendererProofManifest.id]: {
          ...renderer,
          settings: { ...renderer.settings, unknown: false },
        },
      },
    }, catalog)).toBe(false);
    expect(validateLocalPluginState({
      ...valid,
      plugins: {
        ...valid.plugins,
        [rendererProofManifest.id]: {
          desiredEnabled: 'yes',
          settings: renderer.settings,
        },
      },
    }, catalog)).toBe(false);
    expect(validateLocalPluginState({
      ...valid,
      plugins: {
        ...valid.plugins,
        [rendererProofManifest.id]: {
          desiredEnabled: true,
          settings: { focusEnabled: 1 },
        },
      },
    }, catalog)).toBe(false);
  });
});
