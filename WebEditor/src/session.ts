export const PROTOCOL_VERSION = 1;
export const DEFAULT_CHUNK_BYTES = 262_144;
export const MIN_CHUNK_BYTES = 262_144;
export const MAX_CHUNK_BYTES = 524_288;
export const MAX_BODY_BYTES = 16_777_216;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type Envelope = {
  protocolVersion: 1;
  type: string;
  requestId: string;
  sessionId: string;
  sessionGeneration: number;
  revision: number;
  payload: Record<string, unknown>;
};

export type PostMessage = (message: Envelope) => void;
export type HashBytes = (bytes: Uint8Array) => Promise<string>;
export type EditorAuthority = {
  getText(): string;
  replaceDocument(text: string): void;
  setEditable(editable: boolean): void;
  setAppearance?(appearance: "light" | "dark"): void;
};

type Timer = ReturnType<typeof setTimeout>;
type RuntimeOptions = {
  editor: EditorAuthority;
  postMessage: PostMessage;
  hashBytes?: HashBytes;
  uuid?: () => string;
  setTimer?: (callback: () => void, milliseconds: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

type Phase = "unbootstrapped" | "awaitingOpen" | "receivingOpen" | "validatingOpen" | "ready" | "desynced";
type TransferReference = {
  requestId: string;
  revision: number;
  transferId: string;
  utf8ByteLength: number;
  sha256: string;
  purpose: "document.open";
};
type IncomingTransfer = TransferReference & {
  chunkBytes: number;
  totalChunks: number;
  nextIndex: number;
  chunks: Uint8Array[];
  receivedBytes: number;
  timer: Timer;
};
type OutgoingTransfer = {
  requestId: string;
  revision: number;
  transferId: string;
  bytes: Uint8Array;
  sha256: string;
  chunkBytes: number;
  totalChunks: number;
  nextIndex: number;
  awaitingAck: number | null;
  timer: Timer;
};
type SnapshotRequest = {
  requestId: string;
  payloadKey: string;
  frozenRevision: number;
  bytes: Uint8Array;
  transferId: string;
  sha256: string | null;
  transferComplete: boolean;
};
type RequestOutcome = "inFlight" | "completed" | "failed";
type ReceiveResult = { decision: string; outcome?: RequestOutcome; response?: Envelope };
type CachedRequest = {
  type: string;
  revision: number;
  payloadKey: string;
  response: ReceiveResult;
  outcome: RequestOutcome;
};

export type DeltaRecord = {
  transactionId: string;
  fromRevision: number;
  toRevision: number;
  utf8ByteLength: number;
  sha256: string;
};
export type DeltaCandidate = DeltaRecord & { sessionId: string; generation: number };
export type DeltaDecision = "accept" | "ignoreExactDuplicate" | "ignoreRetiredSession" | "rejectWrongSession" | "rejectCheckpointRequired";

export function evaluateDelta(
  current: { sessionId: string; generation: number; revision: number },
  candidate: DeltaCandidate,
  seen: readonly DeltaRecord[],
): DeltaDecision {
  if (candidate.sessionId !== current.sessionId) return "rejectWrongSession";
  if (candidate.generation !== current.generation) return candidate.generation < current.generation ? "ignoreRetiredSession" : "rejectWrongSession";
  const prior = seen.find((item) => item.transactionId === candidate.transactionId);
  if (prior !== undefined) {
    return prior.fromRevision === candidate.fromRevision
      && prior.toRevision === candidate.toRevision
      && prior.utf8ByteLength === candidate.utf8ByteLength
      && prior.sha256 === candidate.sha256
      ? "ignoreExactDuplicate"
      : "rejectCheckpointRequired";
  }
  return candidate.fromRevision === current.revision && candidate.toRevision === current.revision + 1 ? "accept" : "rejectCheckpointRequired";
}

export function evaluateRequestReplay(
  cached: { type: string; revision?: number; payloadSha256: string },
  candidate: { type: string; revision?: number; payloadSha256: string },
): "returnCachedResponse" | "rejectRequestIdConflict" {
  return cached.type === candidate.type && cached.revision === candidate.revision && cached.payloadSha256 === candidate.payloadSha256
    ? "returnCachedResponse"
    : "rejectRequestIdConflict";
}

function isSafeIntegerAtLeast(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function payloadKey(payload: Record<string, unknown>): string {
  return canonicalJson(payload);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hasCanonicalBase64Padding(value: string, byteLength: number): boolean {
  const remainder = byteLength % 3;
  const expectedPadding = remainder === 0 ? 0 : 3 - remainder;
  const actualPadding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if (actualPadding !== expectedPadding) return false;
  if (remainder === 0) return true;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const significantCharacter = value.at(remainder === 1 ? -3 : -2);
  const index = significantCharacter === undefined ? -1 : alphabet.indexOf(significantCharacter);
  return index >= 0 && (remainder === 1 ? (index & 0x0f) === 0 : (index & 0x03) === 0);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function browserSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isDocumentWithinLimit(text: string): boolean {
  return encoder.encode(text).byteLength <= MAX_BODY_BYTES;
}

export function createNativePostMessage(handler: unknown): PostMessage | null {
  if (typeof handler !== "object" || handler === null || !("postMessage" in handler)) return null;
  const postMessage = (handler as { postMessage?: unknown }).postMessage;
  if (typeof postMessage !== "function") return null;
  return (message) => { postMessage.call(handler, message); };
}

function defaultUuid(): string { return crypto.randomUUID(); }

function parseBootstrap(input: unknown): { sessionId: string; sessionGeneration: number } | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (!exactKeys(value, ["command", "sessionId", "sessionGeneration"]) || value.command !== "bootstrap") return null;
  if (typeof value.sessionId !== "string" || !UUID.test(value.sessionId) || !isSafeIntegerAtLeast(value.sessionGeneration, 1)) return null;
  return { sessionId: value.sessionId, sessionGeneration: value.sessionGeneration };
}

function parseEnvelope(input: unknown): Envelope | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (!exactKeys(value, ["protocolVersion", "type", "requestId", "sessionId", "sessionGeneration", "revision", "payload"])) return null;
  if (value.protocolVersion !== PROTOCOL_VERSION || typeof value.type !== "string") return null;
  if (typeof value.requestId !== "string" || !UUID.test(value.requestId)) return null;
  if (typeof value.sessionId !== "string" || !UUID.test(value.sessionId)) return null;
  if (!isSafeIntegerAtLeast(value.sessionGeneration, 1) || !isSafeIntegerAtLeast(value.revision, 0)) return null;
  if (typeof value.payload !== "object" || value.payload === null || Array.isArray(value.payload)) return null;
  return value as Envelope;
}

function isTransferReferencePayload(payload: Record<string, unknown>): payload is Record<string, unknown> & {
  transferId: string; utf8ByteLength: number; sha256: string;
} {
  return exactKeys(payload, ["transferId", "utf8ByteLength", "sha256"])
    && typeof payload.transferId === "string" && UUID.test(payload.transferId)
    && isSafeIntegerAtLeast(payload.utf8ByteLength, 0) && payload.utf8ByteLength <= MAX_BODY_BYTES
    && typeof payload.sha256 === "string" && SHA256.test(payload.sha256);
}

export class EditorSession {
  readonly editor: EditorAuthority;
  readonly postMessage: PostMessage;
  readonly hashBytes: HashBytes;
  readonly uuid: () => string;
  readonly setTimer: (callback: () => void, milliseconds: number) => Timer;
  readonly clearTimer: (timer: Timer) => void;
  sessionId: string | null = null;
  sessionGeneration = 0;
  revision = 0;
  dirty = false;
  savedThroughRevision = -1;
  phase: Phase = "unbootstrapped";
  lastSaveFailure: { code: string; retryable?: boolean } | null = null;
  private hashQueue: Promise<void> = Promise.resolve();
  private pendingReference: TransferReference | null = null;
  private incoming: IncomingTransfer | null = null;
  private outgoing: OutgoingTransfer | null = null;
  private pendingSnapshot: SnapshotRequest | null = null;
  private readonly requestCache = new Map<string, CachedRequest>();
  private openRequest: { requestId: string; payloadKey: string } | null = null;
  private openOperationGeneration = 0;
  private snapshotOperationGeneration = 0;

  constructor(options: RuntimeOptions) {
    this.editor = options.editor;
    this.postMessage = options.postMessage;
    this.hashBytes = options.hashBytes ?? browserSha256;
    this.uuid = options.uuid ?? defaultUuid;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.editor.setEditable(false);
  }

  bootstrap(input: unknown): ReceiveResult {
    if (this.phase !== "unbootstrapped") return { decision: "rejectAlreadyBootstrapped" };
    const command = parseBootstrap(input);
    if (command === null) return { decision: "rejectInvalidBootstrap" };
    this.sessionId = command.sessionId;
    this.sessionGeneration = command.sessionGeneration;
    this.phase = "awaitingOpen";
    this.post("editor.ready", this.uuid(), 0, { capabilities: ["chunks-v1", "revision-v1"] });
    return { decision: "acceptBootstrap" };
  }

  receive(input: unknown): ReceiveResult {
    if (this.phase === "unbootstrapped") return { decision: "rejectNotBootstrapped" };
    const message = parseEnvelope(input);
    if (message === null) return { decision: "rejectInvalidMessage" };
    if (message.sessionId !== this.sessionId) return { decision: "rejectWrongSession" };
    if (message.sessionGeneration < this.sessionGeneration) return { decision: "ignoreRetiredSession" };
    if (message.sessionGeneration !== this.sessionGeneration) return { decision: "rejectWrongSession" };

    switch (message.type) {
      case "document.open": return this.receiveOpen(message);
      case "editor.checkpoint": return { decision: "rejectUnsupportedDirection" };
      case "chunk.begin": return this.beginIncoming(message);
      case "chunk.data": return this.receiveChunk(message);
      case "chunk.end": return this.endIncoming(message);
      case "chunk.ack": return this.receiveAck(message);
      case "document.snapshot.request": return this.requestSnapshot(message);
      case "document.saved": return this.receiveSaved(message);
      case "document.saveFailed": return this.receiveSaveFailed(message);
      case "theme.set": return this.receiveTheme(message);
      default: return { decision: "rejectUnsupportedDirection" };
    }
  }

  recordDocChange(text: string, transactionId = this.uuid()): number | null {
    if (this.phase !== "ready") return null;
    const bytes = encoder.encode(text);
    this.dirty = true;
    if (bytes.byteLength > MAX_BODY_BYTES) {
      this.phase = "desynced";
      this.editor.setEditable(false);
      this.post("error", this.uuid(), this.revision, { code: "bodyTooLarge", message: "Editor content exceeds protocol limit", retryable: false });
      return null;
    }
    if (this.revision >= Number.MAX_SAFE_INTEGER) {
      this.phase = "desynced";
      this.editor.setEditable(false);
      this.post("error", this.uuid(), this.revision, { code: "revisionOverflow", message: "Editor revision limit reached", retryable: false });
      return null;
    }
    const fromRevision = this.revision;
    const toRevision = fromRevision + 1;
    this.revision = toRevision;
    this.hashQueue = this.hashQueue.then(async () => {
      if (this.phase !== "ready") return;
      const sha256 = await this.hashBytes(bytes);
      if (this.phase !== "ready") return;
      this.post("editor.delta", this.uuid(), toRevision, { transactionId, fromRevision, toRevision, utf8ByteLength: bytes.byteLength, sha256 });
    }).catch(() => {
      this.phase = "desynced";
      this.editor.setEditable(false);
      this.post("error", this.uuid(), toRevision, { code: "hashFailed", message: "Editor synchronization failed", retryable: false });
    });
    return toRevision;
  }

  rejectOversizedChange(): void {
    if (this.phase !== "ready") return;
    this.post("error", this.uuid(), this.revision, { code: "bodyTooLarge", message: "Editor content exceeds protocol limit", retryable: true });
  }

  whenIdle(): Promise<void> { return this.hashQueue; }

  cancelTransfer(): boolean {
    if (this.incoming !== null) {
      this.clearTimer(this.incoming.timer);
      this.incoming = null;
      this.pendingReference = null;
      this.openOperationGeneration += 1;
      this.failOpen("transferCancelled", "Transfer cancelled");
      return true;
    }
    if (this.pendingReference !== null) {
      this.pendingReference = null;
      this.openOperationGeneration += 1;
      this.failOpen("transferCancelled", "Transfer cancelled");
      return true;
    }
    if (this.phase === "validatingOpen") {
      this.openOperationGeneration += 1;
      this.failOpen("transferCancelled", "Transfer cancelled");
      return true;
    }
    if (this.outgoing !== null) {
      this.clearTimer(this.outgoing.timer);
      this.outgoing = null;
      this.failSnapshot("transferCancelled");
      return true;
    }
    if (this.pendingSnapshot !== null) {
      this.snapshotOperationGeneration += 1;
      this.failSnapshot("transferCancelled");
      return true;
    }
    return false;
  }

  private receiveOpen(message: Envelope): { decision: string } {
    const key = payloadKey(message.payload);
    if (!isTransferReferencePayload(message.payload)) return { decision: "rejectInvalidPayload" };
    const cached = this.requestCache.get(message.requestId);
    if (cached !== undefined) return this.replay(cached, message, key);
    if (message.revision !== 0) return { decision: "rejectInvalidPayload" };
    if (this.openRequest !== null) {
      return { decision: "rejectOpenAlreadyStarted" };
    }
    if (this.phase !== "awaitingOpen") return { decision: "rejectOpenAlreadyStarted" };
    this.openRequest = { requestId: message.requestId, payloadKey: key };
    const response = { decision: "acceptReference" };
    this.requestCache.set(message.requestId, { type: message.type, revision: message.revision, payloadKey: key, response, outcome: "inFlight" });
    this.pendingReference = {
      requestId: message.requestId,
      revision: 0,
      transferId: message.payload.transferId,
      utf8ByteLength: message.payload.utf8ByteLength,
      sha256: message.payload.sha256,
      purpose: "document.open",
    };
    this.phase = "receivingOpen";
    return response;
  }

  private beginIncoming(message: Envelope): { decision: string } {
    const reference = this.pendingReference;
    const payload = message.payload;
    if (reference === null || this.incoming !== null || this.phase !== "receivingOpen") return { decision: "rejectNoActiveTransfer" };
    if (!exactKeys(payload, ["transferId", "purpose", "totalBytes", "chunkBytes", "totalChunks", "sha256", "timeoutMs"])) return this.failIncoming("rejectInvalidPayload");
    if (payload.transferId !== reference.transferId || payload.purpose !== "document.open"
      || message.requestId !== reference.requestId || message.revision !== reference.revision) return this.failIncoming("rejectCrossTransfer");
    if (!isSafeIntegerAtLeast(payload.totalBytes, 0) || payload.totalBytes > MAX_BODY_BYTES) return this.failIncoming("rejectBodyTooLarge");
    if (!isSafeIntegerAtLeast(payload.chunkBytes, MIN_CHUNK_BYTES) || payload.chunkBytes > MAX_CHUNK_BYTES) return this.failIncoming("rejectInvalidChunkSize");
    if (!isSafeIntegerAtLeast(payload.totalChunks, 1) || payload.totalChunks !== Math.max(1, Math.ceil(payload.totalBytes / payload.chunkBytes))) return this.failIncoming("rejectCountMismatch");
    if (payload.totalBytes !== reference.utf8ByteLength || payload.sha256 !== reference.sha256) return this.failIncoming("rejectTransferReferenceMismatch");
    if (!isSafeIntegerAtLeast(payload.timeoutMs, 1) || payload.timeoutMs > 60_000) return this.failIncoming("rejectInvalidPayload");
    const timer = this.setTimer(() => {
      this.incoming = null;
      this.pendingReference = null;
      this.failOpen("transferTimeout", "Transfer timed out");
    }, payload.timeoutMs);
    this.incoming = { ...reference, chunkBytes: payload.chunkBytes, totalChunks: payload.totalChunks, nextIndex: 0, chunks: [], receivedBytes: 0, timer };
    return { decision: "acceptBegin" };
  }

  private receiveChunk(message: Envelope): { decision: string } {
    const transfer = this.incoming;
    const payload = message.payload;
    if (transfer === null) return { decision: "rejectNoActiveTransfer" };
    if (!exactKeys(payload, ["transferId", "index", "byteLength", "dataBase64"])) return this.failIncoming("rejectInvalidPayload");
    if (payload.transferId !== transfer.transferId || message.requestId !== transfer.requestId || message.revision !== transfer.revision) return this.failIncoming("rejectCrossTransfer");
    if (payload.index !== transfer.nextIndex) return this.failIncoming("rejectOutOfOrder");
    const expectedLength = transfer.nextIndex === transfer.totalChunks - 1
      ? transfer.utf8ByteLength - transfer.chunkBytes * transfer.nextIndex
      : transfer.chunkBytes;
    if (!isSafeIntegerAtLeast(payload.byteLength, 0) || typeof payload.dataBase64 !== "string"
      || payload.byteLength !== expectedLength || payload.byteLength > transfer.chunkBytes
      || transfer.receivedBytes + payload.byteLength > transfer.utf8ByteLength
      || payload.dataBase64.length !== Math.ceil(payload.byteLength / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.dataBase64)
      || !hasCanonicalBase64Padding(payload.dataBase64, payload.byteLength)) {
      return this.failIncoming("rejectLengthMismatch");
    }
    let bytes: Uint8Array;
    try { bytes = base64ToBytes(payload.dataBase64); } catch { return this.failIncoming("rejectInvalidPayload"); }
    if (bytes.byteLength !== payload.byteLength) return this.failIncoming("rejectLengthMismatch");
    transfer.chunks.push(bytes);
    transfer.receivedBytes += bytes.byteLength;
    transfer.nextIndex += 1;
    this.post("chunk.ack", transfer.requestId, transfer.revision, { transferId: transfer.transferId, ackedThrough: payload.index });
    return { decision: "acceptChunk" };
  }

  private endIncoming(message: Envelope): { decision: string } {
    const transfer = this.incoming;
    const payload = message.payload;
    if (transfer === null) return { decision: "rejectNoActiveTransfer" };
    if (!exactKeys(payload, ["transferId", "totalBytes", "totalChunks", "sha256"])
      || payload.transferId !== transfer.transferId || message.requestId !== transfer.requestId || message.revision !== transfer.revision) return this.failIncoming("rejectCrossTransfer");
    if (transfer.nextIndex !== transfer.totalChunks) return this.failIncoming("rejectMissingChunk");
    if (payload.totalBytes !== transfer.utf8ByteLength || payload.totalChunks !== transfer.totalChunks || payload.sha256 !== transfer.sha256) return this.failIncoming("rejectTransferReferenceMismatch");
    const bytes = new Uint8Array(transfer.receivedBytes);
    let offset = 0;
    for (const chunk of transfer.chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    this.clearTimer(transfer.timer);
    this.incoming = null;
    this.pendingReference = null;
    this.phase = "validatingOpen";
    const operationGeneration = ++this.openOperationGeneration;
    this.hashQueue = this.hashQueue.then(async () => {
      const actualSha256 = await this.hashBytes(bytes);
      if (operationGeneration !== this.openOperationGeneration || this.phase !== "validatingOpen") return;
      if (bytes.byteLength !== transfer.utf8ByteLength || actualSha256 !== transfer.sha256) {
        this.failOpen("transferHashMismatch", "Transfer rejected");
        return;
      }
      try {
        const text = decoder.decode(bytes);
        this.editor.replaceDocument(text);
        this.revision = 0;
        this.dirty = false;
        this.phase = "ready";
        this.editor.setEditable(true);
        const cached = this.requestCache.get(transfer.requestId);
        if (cached !== undefined) {
          cached.outcome = "completed";
          cached.response = { decision: "completed", outcome: "completed" };
        }
      } catch {
        this.failOpen("invalidUtf8", "Transfer rejected");
      }
    }).catch(() => {
      if (operationGeneration !== this.openOperationGeneration || this.phase !== "validatingOpen") return;
      this.failOpen("hashFailed", "Transfer validation failed");
    });
    return { decision: "acceptEndPendingValidation" };
  }

  private requestSnapshot(message: Envelope): { decision: string } {
    const payload = message.payload;
    const key = payloadKey(payload);
    if (!exactKeys(payload, ["frozenRevision"]) || !isSafeIntegerAtLeast(payload.frozenRevision, 0)) return { decision: "rejectRevisionMismatch" };
    const cached = this.requestCache.get(message.requestId);
    if (cached !== undefined) return this.replay(cached, message, key);
    if (payload.frozenRevision !== message.revision || message.revision !== this.revision || this.phase !== "ready") return { decision: "rejectRevisionMismatch" };
    if (this.pendingSnapshot !== null || this.outgoing !== null) return { decision: "rejectConcurrentTransfer" };
    const bytes = encoder.encode(this.editor.getText());
    if (bytes.byteLength > MAX_BODY_BYTES) return { decision: "rejectBodyTooLarge" };
    const snapshot: SnapshotRequest = { requestId: message.requestId, payloadKey: key, frozenRevision: this.revision, bytes, transferId: this.uuid(), sha256: null, transferComplete: false };
    this.pendingSnapshot = snapshot;
    const response = { decision: "acceptSnapshot" };
    this.requestCache.set(message.requestId, { type: message.type, revision: message.revision, payloadKey: key, response, outcome: "inFlight" });
    const operationGeneration = ++this.snapshotOperationGeneration;
    this.hashQueue = this.hashQueue.then(async () => {
      if (this.phase !== "ready") {
        this.failSnapshot("sessionDesynced");
        return;
      }
      if (this.pendingSnapshot !== snapshot) return;
      const sha256 = await this.hashBytes(bytes);
      if (operationGeneration !== this.snapshotOperationGeneration || this.pendingSnapshot !== snapshot || this.phase !== "ready") return;
      snapshot.sha256 = sha256;
      const responseEnvelope = this.post("document.snapshot.response", snapshot.requestId, snapshot.frozenRevision, { transferId: snapshot.transferId, utf8ByteLength: bytes.byteLength, sha256 });
      const cached = this.requestCache.get(snapshot.requestId);
      if (cached !== undefined && responseEnvelope !== null) cached.response = { decision: "acceptSnapshot", response: responseEnvelope };
      const totalChunks = Math.max(1, Math.ceil(bytes.byteLength / DEFAULT_CHUNK_BYTES));
      this.post("chunk.begin", snapshot.requestId, snapshot.frozenRevision, {
        transferId: snapshot.transferId, purpose: "document.snapshot.response", totalBytes: bytes.byteLength,
        chunkBytes: DEFAULT_CHUNK_BYTES, totalChunks, sha256, timeoutMs: 10_000,
      });
      const timer = this.setTimer(() => { this.outgoing = null; this.failSnapshot("transferTimeout"); }, 10_000);
      this.outgoing = { requestId: snapshot.requestId, revision: snapshot.frozenRevision, transferId: snapshot.transferId, bytes, sha256, chunkBytes: DEFAULT_CHUNK_BYTES, totalChunks, nextIndex: 0, awaitingAck: null, timer };
      this.sendNextChunk();
    }).catch(() => {
      this.failSnapshot("hashFailed");
    });
    return response;
  }

  private sendNextChunk(): void {
    const transfer = this.outgoing;
    if (transfer === null || transfer.awaitingAck !== null) return;
    if (transfer.nextIndex >= transfer.totalChunks) {
      this.post("chunk.end", transfer.requestId, transfer.revision, { transferId: transfer.transferId, totalBytes: transfer.bytes.byteLength, totalChunks: transfer.totalChunks, sha256: transfer.sha256 });
      this.clearTimer(transfer.timer);
      this.outgoing = null;
      if (this.pendingSnapshot?.requestId === transfer.requestId) this.pendingSnapshot.transferComplete = true;
      return;
    }
    const index = transfer.nextIndex;
    const start = index * transfer.chunkBytes;
    const chunk = transfer.bytes.slice(start, Math.min(start + transfer.chunkBytes, transfer.bytes.byteLength));
    this.post("chunk.data", transfer.requestId, transfer.revision, { transferId: transfer.transferId, index, byteLength: chunk.byteLength, dataBase64: bytesToBase64(chunk) });
    transfer.awaitingAck = index;
  }

  private receiveAck(message: Envelope): { decision: string } {
    const transfer = this.outgoing;
    const payload = message.payload;
    if (transfer === null) return { decision: "rejectLateAck" };
    if (!exactKeys(payload, ["transferId", "ackedThrough"])
      || payload.transferId !== transfer.transferId || message.requestId !== transfer.requestId || message.revision !== transfer.revision) return this.failOutgoing("rejectCrossTransfer");
    if (payload.ackedThrough !== transfer.awaitingAck) return this.failOutgoing("rejectOutOfOrder");
    transfer.nextIndex += 1;
    transfer.awaitingAck = null;
    this.sendNextChunk();
    return { decision: "acceptAck" };
  }

  private receiveSaved(message: Envelope): { decision: string } {
    const payload = message.payload;
    if (!exactKeys(payload, ["durableRevision", "sha256"]) || !isSafeIntegerAtLeast(payload.durableRevision, 0)
      || typeof payload.sha256 !== "string" || !SHA256.test(payload.sha256)) return { decision: "rejectInvalidPayload" };
    const snapshot = this.pendingSnapshot;
    if (snapshot === null) return { decision: "rejectNoPendingSnapshot" };
    if (!snapshot.transferComplete) return { decision: "rejectTransferIncomplete" };
    if (message.requestId !== snapshot.requestId || message.revision !== snapshot.frozenRevision
      || payload.durableRevision !== snapshot.frozenRevision || snapshot.sha256 === null || payload.sha256 !== snapshot.sha256) return { decision: "rejectSnapshotMismatch" };
    if (payload.durableRevision < this.savedThroughRevision) return { decision: "rejectSavedRegression" };
    this.savedThroughRevision = payload.durableRevision;
    this.dirty = this.revision !== payload.durableRevision;
    this.lastSaveFailure = null;
    this.completeSnapshot("completed");
    return { decision: this.dirty ? "acceptDirty" : "acceptClean" };
  }

  private receiveSaveFailed(message: Envelope): { decision: string } {
    const payload = message.payload;
    if (!(exactKeys(payload, ["code", "message"]) || exactKeys(payload, ["code", "message", "retryable"]))
      || typeof payload.code !== "string" || typeof payload.message !== "string"
      || (payload.retryable !== undefined && typeof payload.retryable !== "boolean")) return { decision: "rejectInvalidPayload" };
    const snapshot = this.pendingSnapshot;
    if (snapshot === null) return { decision: "rejectNoPendingSnapshot" };
    if (!snapshot.transferComplete) return { decision: "rejectTransferIncomplete" };
    if (message.requestId !== snapshot.requestId || message.revision !== snapshot.frozenRevision) return { decision: "rejectSnapshotMismatch" };
    this.dirty = true;
    this.lastSaveFailure = payload.retryable === undefined ? { code: payload.code } : { code: payload.code, retryable: payload.retryable };
    this.completeSnapshot("failed");
    return { decision: "acceptSaveFailure" };
  }

  private receiveTheme(message: Envelope): { decision: string } {
    const payload = message.payload;
    if (!exactKeys(payload, ["appearance"]) || (payload.appearance !== "light" && payload.appearance !== "dark")) return { decision: "rejectInvalidPayload" };
    this.editor.setAppearance?.(payload.appearance);
    return { decision: "accept" };
  }

  private failIncoming(decision: string): { decision: string } {
    if (this.incoming !== null) this.clearTimer(this.incoming.timer);
    this.incoming = null;
    this.pendingReference = null;
    this.failOpen("transferRejected", "Transfer rejected");
    return { decision };
  }

  private failOutgoing(decision: string): { decision: string } {
    if (this.outgoing !== null) this.clearTimer(this.outgoing.timer);
    this.outgoing = null;
    this.failSnapshot("transferRejected");
    return { decision };
  }

  private failOpen(code: string, message: string): void {
    this.phase = "desynced";
    this.dirty = true;
    this.editor.setEditable(false);
    const requestId = this.openRequest?.requestId ?? this.uuid();
    const responseEnvelope = this.post("error", requestId, 0, { code, message, retryable: false });
    const cached = this.requestCache.get(requestId);
    if (cached !== undefined) {
      cached.outcome = "failed";
      cached.response = responseEnvelope === null
        ? { decision: "failed", outcome: "failed" }
        : { decision: "failed", outcome: "failed", response: responseEnvelope };
    }
  }

  private failSnapshot(code: string): void {
    const snapshot = this.pendingSnapshot;
    if (snapshot === null) return;
    const responseEnvelope = this.post("error", snapshot.requestId, snapshot.frozenRevision, { code, message: "Snapshot transfer failed", retryable: true });
    const cached = this.requestCache.get(snapshot.requestId);
    if (cached !== undefined && responseEnvelope !== null) cached.response = { decision: "acceptSnapshot", response: responseEnvelope };
    this.completeSnapshot("failed");
  }

  private completeSnapshot(outcome: "completed" | "failed"): void {
    const snapshot = this.pendingSnapshot;
    if (snapshot !== null) {
      const cached = this.requestCache.get(snapshot.requestId);
      if (cached !== undefined) cached.outcome = outcome;
    }
    if (this.outgoing !== null) this.clearTimer(this.outgoing.timer);
    this.outgoing = null;
    this.pendingSnapshot = null;
    this.snapshotOperationGeneration += 1;
  }

  private replay(cached: CachedRequest, message: Envelope, key: string): ReceiveResult {
    if (cached.type !== message.type || cached.revision !== message.revision || cached.payloadKey !== key) {
      return { decision: "rejectRequestIdConflict" };
    }
    return cached.response;
  }

  private post(type: string, requestId: string, revision: number, payload: Record<string, unknown>): Envelope | null {
    if (this.sessionId === null) return null;
    const envelope: Envelope = { protocolVersion: PROTOCOL_VERSION, type, requestId, sessionId: this.sessionId, sessionGeneration: this.sessionGeneration, revision, payload };
    this.postMessage(envelope);
    return envelope;
  }
}
