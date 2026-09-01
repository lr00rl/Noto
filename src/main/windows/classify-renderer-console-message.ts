export type RendererConsoleClassification = 'runtime-noise' | 'diagnostic';

const ELECTRON_SANDBOX_SOURCE = 'node:electron/js2c/sandbox_bundle';
const PLAYWRIGHT_ELECTRON_SANDBOX_MESSAGES = new Set([
  'Electron sandboxed_renderer.bundle.js script failed to run',
  "TypeError: Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null.",
]);

export function classifyRendererConsoleMessage(
  level: number,
  message: string,
  sourceId: string,
): RendererConsoleClassification {
  if (
    level === 3
    && sourceId === ELECTRON_SANDBOX_SOURCE
    && PLAYWRIGHT_ELECTRON_SANDBOX_MESSAGES.has(message)
  ) {
    return 'runtime-noise';
  }

  return 'diagnostic';
}
