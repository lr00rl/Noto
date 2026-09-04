/**
 * Uploading a picture through PicGo.app.
 *
 * Typora's own image uploader, and the one this vault already uses: 2,486 of
 * its image references point at the bucket PicGo puts them in. PicGo.app runs
 * a small HTTP server on the loopback interface, and the whole protocol is one
 * request: post the paths of the files, get back the addresses they now have.
 *
 * Only an `https:` address is accepted back. The renderer's policy allows
 * pictures over TLS and nothing else, so an `http:` address would be written
 * into the note and then shown as not found with no explanation. Refusing it
 * here is the explanation.
 *
 * Everything that touches the network is injected, so the contract can be
 * tested without PicGo and without a bucket.
 */

/** Where PicGo.app listens by default, and where this machine's does. */
export const PICGO_ENDPOINT = 'http://127.0.0.1:36677/upload';

export type UploadOutcome =
  | { readonly uploaded: true; readonly url: string }
  | {
      readonly uploaded: false;
      /**
       * `unreachable`: nothing answered, so PicGo is not running. `refused`:
       * PicGo answered and said no, with its reason. `bad-reply`: something
       * answered that was not PicGo, or PicGo gave back an address the note
       * could not show.
       */
      readonly reason: 'unreachable' | 'refused' | 'bad-reply';
      readonly detail?: string;
    };

export interface UploadDeps {
  readonly fetch: typeof fetch;
  readonly endpoint?: string;
  /** How long to wait for the bucket. A large picture on a slow link is slow. */
  readonly timeoutMs?: number;
}

/**
 * What PicGo answers with. `result` holds one address per file sent, in
 * order; `message` is set when `success` is false.
 */
function parseReply(body: unknown): { urls: string[] } | { failure: string } | null {
  if (typeof body !== 'object' || body === null) return null;
  const reply = body as { success?: unknown; result?: unknown; message?: unknown };
  if (reply.success === true) {
    if (!Array.isArray(reply.result) || !reply.result.every((item) => typeof item === 'string')) return null;
    return { urls: reply.result as string[] };
  }
  if (reply.success === false) {
    return { failure: typeof reply.message === 'string' ? reply.message : 'PicGo refused the upload.' };
  }
  return null;
}

/** An address the note can actually show: absolute, and over TLS. */
export function acceptableUrl(candidate: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  // The parsed form, never the string that arrived: the parser here and the
  // one the renderer resolves with do not have to agree, and a string checked
  // one way and used another is how a check becomes a bug.
  return parsed.href;
}

export async function uploadThroughPicGo(filePath: string, deps: UploadDeps): Promise<UploadOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 60_000);
  let response: Response;
  try {
    response = await deps.fetch(deps.endpoint ?? PICGO_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ list: [filePath] }),
      signal: controller.signal,
    });
  } catch (cause) {
    clearTimeout(timer);
    return {
      uploaded: false,
      reason: 'unreachable',
      detail: cause instanceof Error ? cause.message.slice(0, 200) : undefined,
    };
  }
  clearTimeout(timer);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { uploaded: false, reason: 'bad-reply', detail: `HTTP ${response.status}, not JSON` };
  }
  const parsed = parseReply(body);
  if (parsed === null) return { uploaded: false, reason: 'bad-reply', detail: 'Not a PicGo reply.' };
  if ('failure' in parsed) return { uploaded: false, reason: 'refused', detail: parsed.failure.slice(0, 200) };

  const url = acceptableUrl(parsed.urls[0] ?? '');
  if (url === null) {
    return { uploaded: false, reason: 'bad-reply', detail: 'PicGo gave back an address that is not https.' };
  }
  return { uploaded: true, url };
}
