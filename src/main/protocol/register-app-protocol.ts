import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol, session } from 'electron';
import type { StructuredLogger } from '../logger';

export const RENDERER_ORIGIN = 'noto://bundle';
const productionCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

export function registerNotoScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'noto',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true,
      },
    },
    {
      scheme: 'noto-plugin',
      privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true,
      },
    },
  ]);
}

export async function installNotoProtocol(rendererRoot: string, logger: StructuredLogger): Promise<void> {
  const root = path.resolve(rendererRoot);
  await protocol.handle('noto', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'bundle') return new Response('Not found', { status: 404 });
    const relativePath = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    const candidate = path.resolve(root, relativePath);
    const relative = path.relative(root, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      logger.log('protocol_traversal_denied', { pathname: url.pathname });
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(candidate).toString());
  });

  const appSession = session.defaultSession;
  appSession.setPermissionCheckHandler(() => false);
  appSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  appSession.webRequest.onHeadersReceived({ urls: ['noto://bundle/*'] }, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [productionCsp],
      },
    });
  });
}

export function isAllowedRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'noto:' && url.hostname === 'bundle';
  } catch {
    return false;
  }
}
