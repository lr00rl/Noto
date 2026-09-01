import path from 'node:path';
import { BrowserWindow } from 'electron';
import { summarizeUntrustedText, type StructuredLogger } from '../logger';
import { isAllowedRendererUrl } from '../protocol/register-app-protocol';
import { classifyRendererConsoleMessage } from './classify-renderer-console-message';

export interface RendererConsoleState {
  errors: number;
  warnings: number;
}

export function createEditorWindow(
  preloadPath: string,
  logger: StructuredLogger,
  consoleState: RendererConsoleState,
): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#FAF9F6',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: path.resolve(preloadPath),
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-frame-navigate', (event) => {
    if (!isAllowedRendererUrl(event.url)) {
      event.preventDefault();
      logger.log('navigation_denied', { url: event.url.slice(0, 512) });
    }
  });
  window.webContents.on('console-message', (_event, level, message, lineNumber, sourceId) => {
    if (classifyRendererConsoleMessage(level, message, sourceId) === 'runtime-noise') {
      logger.log('renderer_console_runtime_noise', {
        level,
        lineNumber,
        ...summarizeUntrustedText(message),
      });
      return;
    }
    if (level === 3) consoleState.errors += 1;
    if (level === 2) consoleState.warnings += 1;
    logger.log('renderer_console', {
      level,
      lineNumber,
      ...summarizeUntrustedText(message),
    });
  });
  window.once('ready-to-show', () => window.show());
  void window.loadURL('noto://bundle/index.html');
  return window;
}
