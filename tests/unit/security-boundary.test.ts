import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { classifyRendererConsoleMessage } from '../../src/main/windows/classify-renderer-console-message';

describe('packaged renderer boundary configuration', () => {
  it('keeps Node off, context isolation and sandbox on, and navigation closed', async () => {
    const source = await readFile(new URL('../../src/main/windows/create-editor-window.ts', import.meta.url), 'utf8');
    expect(source).toContain('nodeIntegration: false');
    expect(source).toContain('nodeIntegrationInWorker: false');
    expect(source).toContain('nodeIntegrationInSubFrames: false');
    expect(source).toContain('contextIsolation: true');
    expect(source).toContain('sandbox: true');
    expect(source).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))");
    expect(source).toContain("on('will-frame-navigate'");
  });

  it.each([
    'Electron sandboxed_renderer.bundle.js script failed to run',
    "TypeError: Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null.",
  ])('classifies the exact Playwright Electron sandbox message as runtime noise: %s', (message) => {
    expect(classifyRendererConsoleMessage(3, message, 'node:electron/js2c/sandbox_bundle')).toBe('runtime-noise');
  });

  it.each([
    {
      name: 'wrong source',
      level: 3,
      message: 'Electron sandboxed_renderer.bundle.js script failed to run',
      sourceId: 'node:electron/js2c/renderer_init',
    },
    {
      name: 'wrong level',
      level: 2,
      message: 'Electron sandboxed_renderer.bundle.js script failed to run',
      sourceId: 'node:electron/js2c/sandbox_bundle',
    },
    {
      name: 'prefixed text',
      level: 3,
      message: 'debug: Electron sandboxed_renderer.bundle.js script failed to run',
      sourceId: 'node:electron/js2c/sandbox_bundle',
    },
    {
      name: 'suffixed text',
      level: 3,
      message: 'Electron sandboxed_renderer.bundle.js script failed to run again',
      sourceId: 'node:electron/js2c/sandbox_bundle',
    },
    {
      name: 'near match',
      level: 3,
      message: "TypeError: Cannot destructure property 'preloadScripts' of 'binding.startupData' because it is null.",
      sourceId: 'node:electron/js2c/sandbox_bundle',
    },
    {
      name: 'ordinary console error',
      level: 3,
      message: 'Failed to save the current note',
      sourceId: 'noto://bundle/assets/index.js',
    },
  ])('keeps $name as an app diagnostic', ({ level, message, sourceId }) => {
    expect(classifyRendererConsoleMessage(level, message, sourceId)).toBe('diagnostic');
  });

  it('keeps production CSP restrictive and test controls main-gated', async () => {
    const [protocolSource, handlerSource, shellSource] = await Promise.all([
      readFile(new URL('../../src/main/protocol/register-app-protocol.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/main/ipc/register-handlers.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    ]);
    expect(protocolSource).toContain("default-src 'none'");
    expect(protocolSource).toContain("connect-src 'none'");
    // Pictures may come from the bundle, the asset origin main guards, and the
    // web; nothing else may, and nothing at all may be fetched. The policy is
    // stated twice, as a header and as a meta tag, and the browser applies the
    // stricter of the two, so a picture source added to one and not the other
    // is silently blocked.
    const pictures = "img-src 'self' noto://asset data: blob: https:";
    expect(protocolSource).toContain(pictures);
    expect(shellSource).toContain(pictures);
    expect(protocolSource).toContain('setPermissionCheckHandler(() => false)');
    expect(protocolSource).toContain('setPermissionRequestHandler');
    // Test controls used to exist behind a build-variant gate. They are gone,
    // so there is no gate left to get wrong.
    expect(handlerSource).not.toContain('TEST_MODE_REQUIRED');
    expect(handlerSource).not.toMatch(/testControl/i);
  });

  it('ships no test-only mutation surface in any build variant', async () => {
    const [main, preload, handlers, contracts] = await Promise.all([
      readFile(new URL('../../src/main/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/preload/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/main/file-truth/v1/register-file-truth-handlers.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/shared/file-truth/v1/contracts.ts', import.meta.url), 'utf8'),
    ]);
    // No renderer-reachable channel can inject a save failure or replace a file
    // behind the user's back, in any variant, under any environment variable.
    for (const source of [main, preload, handlers, contracts]) {
      expect(source).not.toMatch(/testControl|TestControl/);
      expect(source).not.toContain('notoFileTruthTest');
      expect(source).not.toContain('NTO_G003_TEST_CONTROLS');
    }
    expect(main).not.toContain('g001Mode');
    expect(main).not.toContain('NTO_G001_MODE');
    // The runtime spike's self-test no longer runs inside the shipping app.
    expect(main).not.toContain('runExperimentalRuntimeSmoke');
  });
});
