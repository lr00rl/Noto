import type { Session } from 'electron';

export const EXPERIMENTAL_PLUGIN_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'none'",
  "img-src 'none'",
  "style-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

export interface ExperimentalPluginProtocolSource {
  sessionToken: string;
  runtimeHtmlBytes: Uint8Array;
  bootstrapModuleBytes: Uint8Array;
  entryModuleBytes: Uint8Array;
}

export type ExperimentalPluginProtocolPath = 'index.html' | 'bootstrap.js' | 'entry.mjs';

export function matchExperimentalPluginProtocolRequest(
  rawUrl: string,
  sessionToken: string,
): ExperimentalPluginProtocolPath | null {
  const origin = `noto-plugin://${sessionToken}`;
  if (rawUrl === `${origin}/` || rawUrl === `${origin}/index.html`) return 'index.html';
  if (rawUrl === `${origin}/bootstrap.js`) return 'bootstrap.js';
  if (rawUrl === `${origin}/entry.mjs`) return 'entry.mjs';
  return null;
}

const response = (bytes: Uint8Array, contentType: string): Response => new Response(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  {
  status: 200,
  headers: {
    'Content-Type': contentType,
    'Content-Security-Policy': EXPERIMENTAL_PLUGIN_CSP,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
  },
);

export async function registerExperimentalPluginProtocol(
  runtimeSession: Session,
  source: ExperimentalPluginProtocolSource,
): Promise<() => Promise<void>> {
  const handler = (request: Request): Response => {
    const matched = matchExperimentalPluginProtocolRequest(request.url, source.sessionToken);
    if (matched === 'index.html') return response(source.runtimeHtmlBytes, 'text/html; charset=utf-8');
    if (matched === 'bootstrap.js') return response(source.bootstrapModuleBytes, 'text/javascript; charset=utf-8');
    if (matched === 'entry.mjs') return response(source.entryModuleBytes, 'text/javascript; charset=utf-8');
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  };
  await runtimeSession.protocol.handle('noto-plugin', handler);
  return async () => { await runtimeSession.protocol.unhandle('noto-plugin'); };
}
