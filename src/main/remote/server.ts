/**
 * The socket the remote control listens on.
 *
 * Loopback only, one port, and nothing at all until the setting says so. The
 * rules live next door in `remote-control`; this is the plumbing: read the
 * body with a ceiling on it, hand it over, write the answer back.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { handleRemote, MAX_BODY_BYTES, type RemoteDeps } from './remote-control';

/** Where it listens. Noto's own, one past PicGo's, and never on any other interface. */
export const REMOTE_HOST = '127.0.0.1';
export const DEFAULT_REMOTE_PORT = 37_610;

/** A token long enough that guessing it is not a strategy. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface RemoteServerOptions {
  readonly port?: number;
  /** Everything but the port, which the socket knows only once it is listening. */
  readonly deps: Omit<RemoteDeps, 'port'>;
  readonly log?: (event: string, detail: Record<string, unknown>) => void;
}

export interface RunningRemote {
  readonly port: number;
  stop(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    // Refused at the socket, not after it has all arrived: a caller that
    // means to fill memory should get nowhere with it.
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Start listening. Rejects when the port is taken, which the caller reports. */
export function startRemoteServer(options: RemoteServerOptions): Promise<RunningRemote> {
  const log = options.log ?? (() => undefined);
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const body = await readBody(request);
      const reply = body === null
        ? { status: 413, body: { error: 'That request is too large.' } }
        : await handleRemote({
          method: request.method ?? 'GET',
          path: request.url ?? '/',
          headers: request.headers as Record<string, string | undefined>,
          body,
        }, { ...options.deps, port: listening });
      log('remote_request', { path: (request.url ?? '/').split('?')[0], status: reply.status });
      const payload = JSON.stringify(reply.body ?? {});
      response.writeHead(reply.status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        // Nothing here is for a browser, and saying so costs one header.
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      });
      response.end(payload);
    })().catch(() => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{"error":"The request failed."}');
    });
  });

  // Filled in the moment the socket is listening, which is before it can
  // answer anything, so no request is ever checked against the wrong port.
  let listening = options.port ?? DEFAULT_REMOTE_PORT;
  return new Promise<RunningRemote>((resolve, reject) => {
    const failed = (error: Error) => { server.close(); reject(error); };
    server.once('error', failed);
    server.listen(options.port ?? DEFAULT_REMOTE_PORT, REMOTE_HOST, () => {
      server.removeListener('error', failed);
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : listening;
      listening = port;
      log('remote_started', { port });
      resolve({
        port,
        stop: () => new Promise<void>((done) => {
          server.close(() => { log('remote_stopped', {}); done(); });
          // A held-open connection must not keep the app from quitting.
          server.closeAllConnections?.();
        }),
      });
    });
  });
}
