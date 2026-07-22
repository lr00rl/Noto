import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { EditorState } from "@codemirror/state";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  entryPoints: [join(root, "src", "session.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
});
const source = bundled.outputFiles[0].text;
const runtime = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const { EditorSession, MAX_BODY_BYTES, createNativePostMessage, evaluateDelta, evaluateRequestReplay, isDocumentWithinLimit } = runtime;
const limitBundle = await build({
  stdin: {
    contents: 'export { EditorState } from "@codemirror/state"; export { documentSizeLimit } from "./src/editor-limits.ts";',
    resolveDir: root,
  },
  bundle: true, format: "esm", platform: "node", target: "node22", write: false,
});
const limitRuntime = await import(`data:text/javascript;base64,${Buffer.from(limitBundle.outputFiles[0].text).toString("base64")}`);

const sessionId = "20000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000001";
const requestId2 = "10000000-0000-4000-8000-000000000002";
const requestId3 = "10000000-0000-4000-8000-000000000003";
const transferId = "30000000-0000-4000-8000-000000000001";
const transactionIds = [
  "40000000-0000-4000-8000-000000000001",
  "40000000-0000-4000-8000-000000000002",
  "40000000-0000-4000-8000-000000000003",
];
const digest = async (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const envelope = (type, revision, payload, overrides = {}) => ({
  protocolVersion: 1,
  type,
  requestId,
  sessionId,
  sessionGeneration: 1,
  revision,
  payload,
  ...overrides,
});
const bootstrap = (overrides = {}) => ({ command: "bootstrap", sessionId, sessionGeneration: 1, ...overrides });

function harness(options = {}) {
  let text = "";
  let replaceCount = 0;
  const editableChanges = [];
  const posted = [];
  let uuidIndex = 0;
  const editor = {
    getText: () => text,
    replaceDocument: (next) => { text = next; replaceCount += 1; },
    setEditable: (editable) => editableChanges.push(editable),
  };
  const session = new EditorSession({
    editor,
    postMessage: (message) => posted.push(message),
    hashBytes: options.hashBytes ?? digest,
    uuid: () => transactionIds[uuidIndex++] ?? "40000000-0000-4000-8000-000000000099",
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  });
  return { session, posted, editor, editableChanges, get text() { return text; }, set text(value) { text = value; }, get replaceCount() { return replaceCount; } };
}

async function openDocument(target, text = "hello world") {
  if (target.session.phase === "unbootstrapped") assert.equal(target.session.bootstrap(bootstrap()).decision, "acceptBootstrap");
  const bytes = Buffer.from(text);
  const bodySha = sha(text);
  assert.equal(target.session.receive(envelope("document.open", 0, { transferId, utf8ByteLength: bytes.length, sha256: bodySha })).decision, "acceptReference");
  assert.equal(target.session.receive(envelope("chunk.begin", 0, {
    transferId, purpose: "document.open", totalBytes: bytes.length, chunkBytes: 262_144,
    totalChunks: 1, sha256: bodySha, timeoutMs: 10_000,
  })).decision, "acceptBegin");
  assert.equal(target.session.receive(envelope("chunk.data", 0, { transferId, index: 0, byteLength: bytes.length, dataBase64: bytes.toString("base64") })).decision, "acceptChunk");
  assert.equal(target.session.receive(envelope("chunk.end", 0, { transferId, totalBytes: bytes.length, totalChunks: 1, sha256: bodySha })).decision, "acceptEndPendingValidation");
  await target.session.whenIdle();
}

function completeSnapshotTransfer(target, snapshotRequestId, revision) {
  let acknowledged = 0;
  while (true) {
    const chunks = target.posted.filter((message) => message.type === "chunk.data" && message.requestId === snapshotRequestId);
    if (acknowledged >= chunks.length) break;
    const chunk = chunks[acknowledged];
    assert.equal(target.session.receive(envelope("chunk.ack", revision, {
      transferId: chunk.payload.transferId, ackedThrough: chunk.payload.index,
    }, { requestId: snapshotRequestId })).decision, "acceptAck");
    acknowledged += 1;
  }
  assert(target.posted.some((message) => message.type === "chunk.end" && message.requestId === snapshotRequestId));
}

test("chunked open atomically replaces the editor at revision zero without a delta", async () => {
  const target = harness();
  await openDocument(target, "# Noto\n");
  assert.equal(target.text, "# Noto\n");
  assert.equal(target.replaceCount, 1);
  assert.equal(target.session.revision, 0);
  assert.equal(target.session.dirty, false);
  assert.deepEqual(target.editableChanges, [false, true]);
  assert.deepEqual(target.posted.map((message) => message.type), ["editor.ready", "chunk.ack"]);
});

test("only document changes reserve revisions and async hashes cannot reorder deltas", async () => {
  const pending = [];
  let hashCalls = 0;
  const target = harness({ hashBytes: (bytes) => hashCalls++ === 0
    ? digest(bytes)
    : new Promise((resolve) => pending.push(() => resolve(sha(Buffer.from(bytes))))) });
  await openDocument(target, "");
  assert.equal(target.session.revision, 0);
  target.text = "α";
  target.session.recordDocChange("α", transactionIds[0]);
  target.text = "αβ";
  target.session.recordDocChange("αβ", transactionIds[1]);
  assert.equal(target.session.revision, 2);
  await setImmediate();
  assert.equal(pending.length, 1);
  pending.shift()();
  await setImmediate();
  assert.equal(pending.length, 1);
  pending.shift()();
  await target.session.whenIdle();
  const deltas = target.posted.filter((message) => message.type === "editor.delta");
  assert.deepEqual(deltas.map((message) => [message.payload.fromRevision, message.payload.toRevision]), [[0, 1], [1, 2]]);
  assert.equal(deltas[0].payload.utf8ByteLength, Buffer.byteLength("α"));
  assert.deepEqual(Object.keys(deltas[0].payload).sort(), ["fromRevision", "sha256", "toRevision", "transactionId", "utf8ByteLength"]);
});

test("snapshot freezes exact revision bytes while later edits remain live", async () => {
  const target = harness();
  await openDocument(target, "one");
  target.text = "one!";
  target.session.recordDocChange(target.text, transactionIds[0]);
  await target.session.whenIdle();
  assert.equal(target.session.receive(envelope("document.snapshot.request", 1, { frozenRevision: 1 }, { requestId: requestId2 })).decision, "acceptSnapshot");
  target.text = "one!!";
  target.session.recordDocChange(target.text, transactionIds[1]);
  await target.session.whenIdle();
  const data = target.posted.find((message) => message.type === "chunk.data");
  assert.equal(Buffer.from(data.payload.dataBase64, "base64").toString(), "one!");
  assert.equal(data.revision, 1);
  const ack = envelope("chunk.ack", 1, { transferId: data.payload.transferId, ackedThrough: 0 }, { requestId: requestId2 });
  assert.equal(target.session.receive(ack).decision, "acceptAck");
  assert(target.posted.some((message) => message.type === "chunk.end" && message.revision === 1));
  assert.equal(target.session.revision, 2);
  assert.equal(target.text, "one!!");
});

test("saved revision clears dirty only for the current revision and failures stay dirty", async () => {
  const target = harness();
  await openDocument(target, "a");
  target.text = "ab";
  target.session.recordDocChange(target.text, transactionIds[0]);
  await target.session.whenIdle();
  assert.equal(target.session.receive(envelope("document.snapshot.request", 1, { frozenRevision: 1 }, { requestId: requestId2 })).decision, "acceptSnapshot");
  await target.session.whenIdle();
  completeSnapshotTransfer(target, requestId2, 1);
  target.text = "abc";
  target.session.recordDocChange(target.text, transactionIds[1]);
  await target.session.whenIdle();
  assert.equal(target.session.receive(envelope("document.saved", 1, { durableRevision: 1, sha256: sha("ab") }, { requestId: requestId2 })).decision, "acceptDirty");
  assert.equal(target.session.dirty, true);
  assert.equal(target.session.receive(envelope("document.snapshot.request", 2, { frozenRevision: 2 }, { requestId: requestId3 })).decision, "acceptSnapshot");
  await target.session.whenIdle();
  completeSnapshotTransfer(target, requestId3, 2);
  assert.equal(target.session.receive(envelope("document.saved", 2, { durableRevision: 2, sha256: sha("abc") }, { requestId: requestId3 })).decision, "acceptClean");
  assert.equal(target.session.dirty, false);
  assert.equal(target.session.receive(envelope("document.saved", 3, { durableRevision: 3, sha256: sha("future") }, { requestId: requestId3 })).decision, "rejectNoPendingSnapshot");
  assert.equal(target.session.receive(envelope("document.saveFailed", 2, { code: "replaceFailed", message: "redacted", retryable: true }, { requestId: requestId3 })).decision, "rejectNoPendingSnapshot");
});

test("revision fixture delta decisions match the runtime oracle", async () => {
  const fixtures = (await import(pathToFileURL(join(root, "..", "Tests", "Fixtures", "BridgeProtocol", "v1", "revision-cases.json")), { with: { type: "json" } })).default;
  for (const fixture of fixtures.filter((item) => item.kind === "delta")) {
    assert.equal(evaluateDelta(fixture.current, fixture.candidate, fixture.seen), fixture.expected, fixture.name);
  }
  for (const fixture of fixtures.filter((item) => item.kind === "requestReplay")) {
    assert.equal(evaluateRequestReplay(fixture.cached, fixture.candidate), fixture.expected, fixture.name);
  }
});

test("invalid identity, unsafe integers, chunk limits, ordering, timeout and cancel reject safely", () => {
  const timers = [];
  const target = harness({ setTimer: (callback) => { timers.push(callback); return timers.length; }, clearTimer: () => {} });
  assert.equal(target.session.bootstrap(bootstrap({ sessionGeneration: sessionId })).decision, "rejectInvalidBootstrap");
  assert.equal(target.session.bootstrap(bootstrap()).decision, "acceptBootstrap");
  assert.equal(target.session.receive(envelope("document.open", Number.MAX_SAFE_INTEGER + 1, { transferId, utf8ByteLength: 1, sha256: sha("a") })).decision, "rejectInvalidMessage");
  assert.equal(target.session.receive(envelope("document.open", 0, { transferId, utf8ByteLength: MAX_BODY_BYTES + 1, sha256: sha("a") })).decision, "rejectInvalidPayload");
  assert.equal(target.session.receive(envelope("document.open", 0, { transferId, utf8ByteLength: 1, sha256: sha("a") })).decision, "acceptReference");
  assert.equal(target.session.receive(envelope("chunk.begin", 0, { transferId, purpose: "document.open", totalBytes: 1, chunkBytes: 262_144, totalChunks: 1, sha256: sha("a"), timeoutMs: 10_000 })).decision, "acceptBegin");
  assert.equal(target.session.receive(envelope("chunk.data", 0, { transferId, index: 1, byteLength: 1, dataBase64: "YQ==" })).decision, "rejectOutOfOrder");
  assert.equal(target.session.cancelTransfer(), false, "failed frame already discarded the transfer");
  assert.equal(target.session.receive(envelope("chunk.data", 0, { transferId, index: 0, byteLength: 1, dataBase64: "YQ==" })).decision, "rejectNoActiveTransfer");
});

test("chunk payload bounds and canonical encoded length reject before atob", () => {
  const originalAtob = globalThis.atob;
  let atobCalls = 0;
  globalThis.atob = (value) => { atobCalls += 1; return originalAtob(value); };
  try {
    for (const { expectedLength, payload } of [
      { expectedLength: 1, payload: { byteLength: 1, dataBase64: "YQ==YQ==" } },
      { expectedLength: 1, payload: { byteLength: 2, dataBase64: "YQ==" } },
      { expectedLength: 1, payload: { byteLength: 1, dataBase64: "YR==" } },
      { expectedLength: 3, payload: { byteLength: 3, dataBase64: "YQ==" } },
      { expectedLength: 1, payload: { byteLength: 1, dataBase64: "YQAA" } },
      { expectedLength: 2, payload: { byteLength: 2, dataBase64: "YWEA" } },
      { expectedLength: 1, payload: { byteLength: 1, dataBase64: "Y@==" } },
      { expectedLength: 1, payload: { byteLength: 524_289, dataBase64: "A".repeat(Math.ceil(524_289 / 3) * 4) } },
    ]) {
      const target = harness();
      target.session.bootstrap(bootstrap());
      target.session.receive(envelope("document.open", 0, { transferId, utf8ByteLength: expectedLength, sha256: sha("a") }));
      target.session.receive(envelope("chunk.begin", 0, {
        transferId, purpose: "document.open", totalBytes: expectedLength, chunkBytes: 262_144,
        totalChunks: 1, sha256: sha("a"), timeoutMs: 10_000,
      }));
      assert.equal(target.session.receive(envelope("chunk.data", 0, { transferId, index: 0, ...payload })).decision, "rejectLengthMismatch");
    }
    assert.equal(atobCalls, 0);
  } finally {
    globalThis.atob = originalAtob;
  }
});

test("hash mismatch and timeout fail explicitly without partial editor publication", async () => {
  const timers = [];
  const target = harness({ setTimer: (callback) => { timers.push(callback); return timers.length; }, clearTimer: () => {} });
  const wrongSha = "a".repeat(64);
  target.session.bootstrap(bootstrap());
  target.session.receive(envelope("document.open", 0, { transferId, utf8ByteLength: 1, sha256: wrongSha }));
  target.session.receive(envelope("chunk.begin", 0, { transferId, purpose: "document.open", totalBytes: 1, chunkBytes: 262_144, totalChunks: 1, sha256: wrongSha, timeoutMs: 10_000 }));
  target.session.receive(envelope("chunk.data", 0, { transferId, index: 0, byteLength: 1, dataBase64: "YQ==" }));
  target.session.receive(envelope("chunk.end", 0, { transferId, totalBytes: 1, totalChunks: 1, sha256: wrongSha }));
  await target.session.whenIdle();
  assert.equal(target.replaceCount, 0);
  assert(target.posted.some((message) => message.type === "error" && message.payload.code === "transferHashMismatch"));

  const timeoutTarget = harness({ setTimer: (callback) => { timers.push(callback); return timers.length; }, clearTimer: () => {} });
  timeoutTarget.session.bootstrap(bootstrap());
  timeoutTarget.session.receive(envelope("document.open", 0, { transferId, utf8ByteLength: 1, sha256: sha("a") }));
  timeoutTarget.session.receive(envelope("chunk.begin", 0, { transferId, purpose: "document.open", totalBytes: 1, chunkBytes: 262_144, totalChunks: 1, sha256: sha("a"), timeoutMs: 10_000 }));
  timers.at(-1)();
  assert(timeoutTarget.posted.some((message) => message.type === "error" && message.payload.code === "transferTimeout"));
  assert.equal(timeoutTarget.replaceCount, 0);
});

test("bridge bookkeeping preserves CodeMirror selection and invertible edit authority", async () => {
  const target = harness();
  await openDocument(target, "abc");
  const before = EditorState.create({ doc: "abc", selection: { anchor: 1 } });
  const edit = before.update({ changes: { from: 3, insert: "!" } });
  const inverse = edit.changes.invert(before.doc);
  target.text = edit.state.doc.toString();
  target.session.recordDocChange(target.text, transactionIds[0]);
  await target.session.whenIdle();
  assert.equal(edit.state.selection.main.anchor, 1);
  assert.equal(target.replaceCount, 1, "runtime must not reconstruct editor state for deltas");
  const undone = edit.state.update({ changes: inverse });
  assert.equal(undone.state.doc.toString(), "abc");
  assert.equal(undone.state.selection.main.anchor, 1);
});

test("wrong sessions and retired generations are rejected or ignored without content diagnostics", async () => {
  const target = harness();
  await openDocument(target, "private markdown");
  assert.equal(target.session.receive(envelope("theme.set", 0, { appearance: "dark" }, { sessionId: "20000000-0000-4000-8000-000000000002" })).decision, "rejectWrongSession");
  assert.equal(target.session.receive(envelope("theme.set", 0, { appearance: "dark" }, { sessionGeneration: 0 })).decision, "rejectInvalidMessage");
  assert.equal(JSON.stringify(target.posted).includes("private markdown"), false);
});

test("review blocker: bootstrap emits ready once and edits remain blocked until verified open", async () => {
  const target = harness();
  assert.equal(target.session.receive(bootstrap()).decision, "rejectNotBootstrapped", "receive accepts only v1 envelopes");
  assert.equal(target.session.receive(envelope("theme.set", 0, { appearance: "dark" })).decision, "rejectNotBootstrapped");
  assert.equal(target.session.bootstrap(bootstrap()).decision, "acceptBootstrap");
  assert.deepEqual(target.posted.filter((message) => message.type === "editor.ready").map((message) => message.payload), [
    { capabilities: ["chunks-v1", "revision-v1"] },
  ]);
  assert.equal(target.session.bootstrap(bootstrap()).decision, "rejectAlreadyBootstrapped");
  assert.equal(target.session.recordDocChange("blocked", transactionIds[0]), null);
});

test("review blocker: open validation blocks edits and open replay never publishes twice", async () => {
  let finishHash;
  const target = harness({ hashBytes: () => new Promise((resolve) => { finishHash = resolve; }) });
  assert.equal(target.session.bootstrap(bootstrap()).decision, "acceptBootstrap");
  const bytes = Buffer.from("open");
  const bodySha = sha("open");
  const reference = envelope("document.open", 0, { transferId, utf8ByteLength: bytes.length, sha256: bodySha });
  assert.equal(target.session.receive(reference).decision, "acceptReference");
  target.session.receive(envelope("chunk.begin", 0, { transferId, purpose: "document.open", totalBytes: bytes.length, chunkBytes: 262_144, totalChunks: 1, sha256: bodySha, timeoutMs: 10_000 }));
  target.session.receive(envelope("chunk.data", 0, { transferId, index: 0, byteLength: bytes.length, dataBase64: bytes.toString("base64") }));
  target.session.receive(envelope("chunk.end", 0, { transferId, totalBytes: bytes.length, totalChunks: 1, sha256: bodySha }));
  assert.equal(target.session.recordDocChange("must not reserve", transactionIds[0]), null);
  await Promise.resolve();
  finishHash(bodySha);
  await target.session.whenIdle();
  assert.equal(target.session.revision, 0);
  assert.deepEqual(target.session.receive(reference), { decision: "completed", outcome: "completed" });
  assert.equal(target.replaceCount, 1);
});

test("review blocker: stale inbound checkpoint cannot overwrite live editor state", async () => {
  const target = harness();
  target.session.bootstrap(bootstrap());
  await openDocument(target, "live");
  target.text = "live!";
  target.session.recordDocChange(target.text, transactionIds[0]);
  await target.session.whenIdle();
  const checkpoint = envelope("editor.checkpoint", 0, { transferId, utf8ByteLength: 5, sha256: sha("stale") });
  assert.equal(target.session.receive(checkpoint).decision, "rejectUnsupportedDirection");
  assert.equal(target.text, "live!");
  assert.equal(target.session.revision, 1);
});

test("review blocker: snapshots are synchronous single-flight with exact/conflicting replay", async () => {
  const target = harness();
  target.session.bootstrap(bootstrap());
  await openDocument(target, "snap");
  const request = envelope("document.snapshot.request", 0, { frozenRevision: 0 }, { requestId: requestId2 });
  assert.equal(target.session.receive(request).decision, "acceptSnapshot");
  assert.deepEqual(target.session.receive({ ...request }), { decision: "acceptSnapshot" });
  assert.equal(target.session.receive({ ...request, revision: 1 }).decision, "rejectRequestIdConflict");
  assert.equal(target.session.receive(envelope("document.open", 0, { transferId, utf8ByteLength: 4, sha256: sha("snap") }, { requestId: requestId2 })).decision, "rejectRequestIdConflict");
  assert.equal(target.session.receive({ ...request, payload: { frozenRevision: 0, extra: true } }).decision, "rejectRevisionMismatch");
  assert.equal(target.session.receive(envelope("document.snapshot.request", 0, { frozenRevision: 0 }, { requestId: requestId3 })).decision, "rejectConcurrentTransfer");
  await target.session.whenIdle();
  const actualResponse = target.posted.find((message) => message.type === "document.snapshot.response" && message.requestId === requestId2);
  const replay = target.session.receive({ ...request });
  assert.deepEqual(replay, { decision: "acceptSnapshot", response: actualResponse });
  assert.equal("dataBase64" in replay.response.payload, false);
});

test("request replay identity includes revision and recursively canonical payload", () => {
  assert.equal(evaluateRequestReplay(
    { type: "document.snapshot.request", revision: 4, payloadSha256: "canonical" },
    { type: "document.snapshot.request", revision: 4, payloadSha256: "canonical" },
  ), "returnCachedResponse");
  assert.equal(evaluateRequestReplay(
    { type: "document.snapshot.request", revision: 4, payloadSha256: "canonical" },
    { type: "document.snapshot.request", revision: 5, payloadSha256: "canonical" },
  ), "rejectRequestIdConflict");
});

test("review blocker: saved and saveFailed require the matching frozen snapshot", async () => {
  const target = harness();
  target.session.bootstrap(bootstrap());
  await openDocument(target, "save");
  target.text = "save!";
  target.session.recordDocChange(target.text, transactionIds[0]);
  await target.session.whenIdle();
  assert.equal(target.session.receive(envelope("document.saved", 1, { durableRevision: 1, sha256: sha("save!") })).decision, "rejectNoPendingSnapshot");
  assert.equal(target.session.dirty, true);
  assert.equal(target.session.receive(envelope("document.saveFailed", 1, { code: "x", message: "redacted" })).decision, "rejectNoPendingSnapshot");
});

test("review blocker: transfer frames bind request and revision and failures discard assembly", () => {
  const target = harness();
  target.session.bootstrap(bootstrap());
  target.session.receive(envelope("document.open", 0, { transferId, utf8ByteLength: 1, sha256: sha("a") }));
  target.session.receive(envelope("chunk.begin", 0, { transferId, purpose: "document.open", totalBytes: 1, chunkBytes: 262_144, totalChunks: 1, sha256: sha("a"), timeoutMs: 10_000 }));
  assert.equal(target.session.receive(envelope("chunk.data", 1, { transferId, index: 0, byteLength: 1, dataBase64: "YQ==" })).decision, "rejectCrossTransfer");
  assert.equal(target.session.receive(envelope("chunk.end", 0, { transferId, totalBytes: 1, totalChunks: 1, sha256: sha("a") })).decision, "rejectNoActiveTransfer");
});

test("review blocker: oversized live text emits no invalid delta and enters desync", async () => {
  const target = harness();
  await openDocument(target, "");
  const oversized = "a".repeat(MAX_BODY_BYTES + 1);
  assert.equal(target.session.recordDocChange(oversized, transactionIds[0]), null);
  assert.equal(target.posted.some((message) => message.type === "editor.delta"), false);
  assert(target.posted.some((message) => message.type === "error" && message.payload.code === "bodyTooLarge"));
  assert.equal(target.session.dirty, true);
});

test("fresh gate: CodeMirror rejects limit plus one atomically while exact 16 MiB remains valid", async () => {
  const exact = "a".repeat(MAX_BODY_BYTES);
  const target = harness();
  await openDocument(target, "");
  assert.equal(isDocumentWithinLimit(exact), true);
  const sizeLimit = limitRuntime.documentSizeLimit(() => target.session.rejectOversizedChange());
  const initial = limitRuntime.EditorState.create({ doc: "", selection: { anchor: 0 }, extensions: [sizeLimit] });
  const accepted = initial.update({ changes: { from: 0, insert: exact } });
  assert.equal(accepted.state.doc.length, MAX_BODY_BYTES);
  const before = {
    revision: target.session.revision,
    dirty: target.session.dirty,
    phase: target.session.phase,
    editableChanges: [...target.editableChanges],
  };
  const rejected = accepted.state.update({ changes: { from: accepted.state.doc.length, insert: "b" } });
  assert.equal(rejected.docChanged, false);
  assert.equal(rejected.state.doc.length, MAX_BODY_BYTES);
  assert.equal(rejected.state.selection.main.anchor, 0);
  assert.equal(target.session.phase, "ready", "rejection callback must not dispatch reentrantly from the filter");
  await Promise.resolve();
  assert.equal(target.session.revision, before.revision);
  assert.equal(target.session.dirty, before.dirty);
  assert.equal(target.session.phase, before.phase);
  assert.deepEqual(target.editableChanges, before.editableChanges);
  const signals = target.posted.filter((message) => message.type === "error" && message.payload.code === "bodyTooLarge");
  assert.equal(signals.length, 1);
  assert.equal(JSON.stringify(signals).includes(exact.slice(0, 64)), false);
});

test("fresh gate: limit rejection preserves an already-dirty editable session", async () => {
  const exact = "a".repeat(MAX_BODY_BYTES);
  const target = harness();
  await openDocument(target, "a");
  target.text = "ab";
  target.session.recordDocChange(target.text, transactionIds[0]);
  await target.session.whenIdle();
  const sizeLimit = limitRuntime.documentSizeLimit(() => target.session.rejectOversizedChange());
  const state = limitRuntime.EditorState.create({ doc: exact, selection: { anchor: 7 }, extensions: [sizeLimit] });
  const before = {
    text: state.doc.toString(), selection: state.selection.main.anchor,
    revision: target.session.revision, dirty: target.session.dirty,
    phase: target.session.phase, editableChanges: [...target.editableChanges],
  };
  const rejected = state.update({ changes: { from: state.doc.length, insert: "b" } });
  await Promise.resolve();
  assert.equal(rejected.state.doc.toString(), before.text);
  assert.equal(rejected.state.selection.main.anchor, before.selection);
  assert.equal(target.session.revision, before.revision);
  assert.equal(target.session.dirty, before.dirty);
  assert.equal(target.session.phase, before.phase);
  assert.deepEqual(target.editableChanges, before.editableChanges);
  const signal = target.posted.at(-1);
  assert.equal(signal.type, "error");
  assert.deepEqual(signal.payload, { code: "bodyTooLarge", message: "Editor content exceeds protocol limit", retryable: true });
  assert.equal(JSON.stringify(signal).includes(exact.slice(0, 64)), false);
});

test("fresh gate: native handler resolution is explicit and never silently drops posts", () => {
  assert.equal(createNativePostMessage(undefined), null);
  assert.equal(createNativePostMessage({}), null);
  const posted = [];
  const adapter = createNativePostMessage({ postMessage: (message) => posted.push(message) });
  assert.equal(typeof adapter, "function");
  adapter({ protocolVersion: 1, type: "editor.ready", requestId, sessionId, sessionGeneration: 1, revision: 0, payload: { capabilities: [] } });
  assert.equal(posted.length, 1);
});

test("fresh gate: rejected delta hash emits fatal metadata and leaves queue settled", async () => {
  let hashCalls = 0;
  const target = harness({ hashBytes: (bytes) => hashCalls++ === 0 ? digest(bytes) : Promise.reject(new Error("hash unavailable")) });
  await openDocument(target, "a");
  target.text = "ab";
  assert.equal(target.session.recordDocChange(target.text, transactionIds[0]), 1);
  await target.session.whenIdle();
  assert.equal(target.session.phase, "desynced");
  assert.equal(target.session.recordDocChange("abc", transactionIds[1]), null);
  assert(target.posted.some((message) => message.type === "error" && message.payload.code === "hashFailed"));
  assert.equal(JSON.stringify(target.posted).includes("hash unavailable"), false);
});

test("fresh gate: first rejected rapid-edit hash suppresses every queued later delta", async () => {
  let hashCalls = 0;
  const target = harness({ hashBytes: (bytes) => {
    hashCalls += 1;
    if (hashCalls === 1) return digest(bytes);
    if (hashCalls === 2) return Promise.reject(new Error("first delta failed"));
    return digest(bytes);
  } });
  await openDocument(target, "a");
  target.session.recordDocChange("ab", transactionIds[0]);
  target.session.recordDocChange("abc", transactionIds[1]);
  await target.session.whenIdle();
  assert.equal(target.session.phase, "desynced");
  assert.equal(target.posted.filter((message) => message.type === "editor.delta").length, 0);
  assert.equal(target.posted.filter((message) => message.type === "error" && message.payload.code === "hashFailed").length, 1);
});

test("fresh gate: rejected open and snapshot hashes fail explicitly without poisoning whenIdle", async () => {
  const openTarget = harness({ hashBytes: () => Promise.reject(new Error("open secret")) });
  openTarget.session.bootstrap(bootstrap());
  const bytes = Buffer.from("a");
  openTarget.session.receive(envelope("document.open", 0, { transferId, utf8ByteLength: 1, sha256: sha("a") }));
  openTarget.session.receive(envelope("chunk.begin", 0, { transferId, purpose: "document.open", totalBytes: 1, chunkBytes: 262_144, totalChunks: 1, sha256: sha("a"), timeoutMs: 10_000 }));
  openTarget.session.receive(envelope("chunk.data", 0, { transferId, index: 0, byteLength: 1, dataBase64: bytes.toString("base64") }));
  openTarget.session.receive(envelope("chunk.end", 0, { transferId, totalBytes: 1, totalChunks: 1, sha256: sha("a") }));
  await openTarget.session.whenIdle();
  assert.equal(openTarget.replaceCount, 0);
  assert.equal(openTarget.session.phase, "desynced");

  let calls = 0;
  const snapshotTarget = harness({ hashBytes: (value) => calls++ === 0 ? digest(value) : Promise.reject(new Error("snapshot secret")) });
  await openDocument(snapshotTarget, "a");
  snapshotTarget.session.receive(envelope("document.snapshot.request", 0, { frozenRevision: 0 }, { requestId: requestId2 }));
  await snapshotTarget.session.whenIdle();
  assert(snapshotTarget.posted.some((message) => message.type === "error" && message.payload.code === "hashFailed"));
  assert.equal(snapshotTarget.session.receive(envelope("document.snapshot.request", 0, { frozenRevision: 0 }, { requestId: requestId3 })).decision, "acceptSnapshot");
});

test("fresh gate: saved and saveFailed reject before snapshot chunk end", async () => {
  const target = harness();
  await openDocument(target, "save");
  target.session.receive(envelope("document.snapshot.request", 0, { frozenRevision: 0 }, { requestId: requestId2 }));
  await target.session.whenIdle();
  assert.equal(target.session.receive(envelope("document.saved", 0, { durableRevision: 0, sha256: sha("save") }, { requestId: requestId2 })).decision, "rejectTransferIncomplete");
  assert.equal(target.session.receive(envelope("document.saveFailed", 0, { code: "x", message: "redacted" }, { requestId: requestId2 })).decision, "rejectTransferIncomplete");
  completeSnapshotTransfer(target, requestId2, 0);
  assert.equal(target.session.receive(envelope("document.saved", 0, { durableRevision: 0, sha256: sha("save") }, { requestId: requestId2 })).decision, "acceptClean");
});

test("fresh gate: real multi-chunk snapshot has a strict one-chunk ACK window", async () => {
  const target = harness();
  const large = "a".repeat(262_145);
  await openDocument(target, "a");
  target.text = large;
  target.session.recordDocChange(large, transactionIds[0]);
  await target.session.whenIdle();
  target.session.receive(envelope("document.snapshot.request", 1, { frozenRevision: 1 }, { requestId: requestId2 }));
  await target.session.whenIdle();
  let chunks = target.posted.filter((message) => message.type === "chunk.data" && message.requestId === requestId2);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].payload.byteLength, 262_144);
  assert.equal(target.posted.some((message) => message.type === "chunk.end" && message.requestId === requestId2), false);
  assert.equal(target.session.receive(envelope("chunk.ack", 1, { transferId: chunks[0].payload.transferId, ackedThrough: 0 }, { requestId: requestId2 })).decision, "acceptAck");
  chunks = target.posted.filter((message) => message.type === "chunk.data" && message.requestId === requestId2);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].payload.byteLength, 1);
  assert.equal(target.posted.some((message) => message.type === "chunk.end" && message.requestId === requestId2), false);
  assert.equal(target.session.receive(envelope("chunk.ack", 1, { transferId: chunks[1].payload.transferId, ackedThrough: 1 }, { requestId: requestId2 })).decision, "acceptAck");
  assert(target.posted.some((message) => message.type === "chunk.end" && message.requestId === requestId2));
});

test("final review: open conflicts and later opens never restart editor state", async () => {
  const target = harness();
  target.session.bootstrap(bootstrap());
  const first = envelope("document.open", 0, { transferId, utf8ByteLength: 1, sha256: sha("a") });
  assert.equal(target.session.receive(first).decision, "acceptReference");
  assert.equal(target.session.receive({ ...first, payload: { ...first.payload, sha256: sha("b") } }).decision, "rejectRequestIdConflict");
  assert.equal(target.session.receive({ ...first, revision: 1 }).decision, "rejectRequestIdConflict");
  assert.equal(target.session.receive(envelope("document.open", 0, first.payload, { requestId: requestId2 })).decision, "rejectOpenAlreadyStarted");
});

test("final review: saved correlation rejects request, revision, durable revision and hash mismatches", async () => {
  const cases = [
    { name: "request", overrides: { requestId: requestId3 }, revision: 1, payload: { durableRevision: 1, sha256: sha("save!") } },
    { name: "envelope revision", overrides: { requestId: requestId2 }, revision: 2, payload: { durableRevision: 1, sha256: sha("save!") } },
    { name: "durable revision", overrides: { requestId: requestId2 }, revision: 1, payload: { durableRevision: 2, sha256: sha("save!") } },
    { name: "hash", overrides: { requestId: requestId2 }, revision: 1, payload: { durableRevision: 1, sha256: sha("wrong") } },
  ];
  for (const item of cases) {
    const target = harness();
    await openDocument(target, "save");
    target.text = "save!";
    target.session.recordDocChange(target.text, transactionIds[0]);
    await target.session.whenIdle();
    target.session.receive(envelope("document.snapshot.request", 1, { frozenRevision: 1 }, { requestId: requestId2 }));
    await target.session.whenIdle();
    completeSnapshotTransfer(target, requestId2, 1);
    assert.equal(target.session.receive(envelope("document.saved", item.revision, item.payload, item.overrides)).decision, "rejectSnapshotMismatch", item.name);
    assert.equal(target.session.dirty, true, item.name);
    assert.equal(target.session.savedThroughRevision, -1, item.name);
  }
});

test("final review: matching save failure remains dirty while unrelated failure preserves pending snapshot", async () => {
  const target = harness();
  await openDocument(target, "save");
  target.session.receive(envelope("document.snapshot.request", 0, { frozenRevision: 0 }, { requestId: requestId2 }));
  await target.session.whenIdle();
  completeSnapshotTransfer(target, requestId2, 0);
  assert.equal(target.session.receive(envelope("document.saveFailed", 0, { code: "replaceFailed", message: "redacted" }, { requestId: requestId3 })).decision, "rejectSnapshotMismatch");
  assert.equal(target.session.receive(envelope("document.saveFailed", 0, { code: "replaceFailed", message: "redacted", retryable: true }, { requestId: requestId2 })).decision, "acceptSaveFailure");
  assert.equal(target.session.dirty, true);
  assert.deepEqual(target.session.lastSaveFailure, { code: "replaceFailed", retryable: true });
});

test("final review: wrong request and revision data/end frames discard open transfer", () => {
  for (const frame of [
    envelope("chunk.data", 0, { transferId, index: 0, byteLength: 1, dataBase64: "YQ==" }, { requestId: requestId2 }),
    envelope("chunk.data", 1, { transferId, index: 0, byteLength: 1, dataBase64: "YQ==" }),
    envelope("chunk.end", 0, { transferId, totalBytes: 1, totalChunks: 1, sha256: sha("a") }, { requestId: requestId2 }),
    envelope("chunk.end", 1, { transferId, totalBytes: 1, totalChunks: 1, sha256: sha("a") }),
  ]) {
    const target = harness();
    target.session.bootstrap(bootstrap());
    target.session.receive(envelope("document.open", 0, { transferId, utf8ByteLength: 1, sha256: sha("a") }));
    target.session.receive(envelope("chunk.begin", 0, { transferId, purpose: "document.open", totalBytes: 1, chunkBytes: 262_144, totalChunks: 1, sha256: sha("a"), timeoutMs: 10_000 }));
    assert.equal(target.session.receive(frame).decision, "rejectCrossTransfer");
    assert.equal(target.session.receive(envelope("chunk.data", 0, { transferId, index: 0, byteLength: 1, dataBase64: "YQ==" })).decision, "rejectNoActiveTransfer");
    assert.equal(target.replaceCount, 0);
  }
});

test("final review: wrong request, revision, duplicate and late acknowledgements cancel snapshot transfer", async () => {
  for (const overrides of [{ requestId: requestId3 }, { revision: 1 }]) {
    const target = harness();
    await openDocument(target, "ack");
    target.session.receive(envelope("document.snapshot.request", 0, { frozenRevision: 0 }, { requestId: requestId2 }));
    await target.session.whenIdle();
    const data = target.posted.find((message) => message.type === "chunk.data");
    const ack = envelope("chunk.ack", 0, { transferId: data.payload.transferId, ackedThrough: 0 }, { requestId: requestId2, ...overrides });
    assert.equal(target.session.receive(ack).decision, "rejectCrossTransfer");
    assert.equal(target.session.receive(envelope("chunk.ack", 0, { transferId: data.payload.transferId, ackedThrough: 0 }, { requestId: requestId2 })).decision, "rejectLateAck");
  }

  const target = harness();
  await openDocument(target, "ack");
  target.session.receive(envelope("document.snapshot.request", 0, { frozenRevision: 0 }, { requestId: requestId2 }));
  await target.session.whenIdle();
  const data = target.posted.find((message) => message.type === "chunk.data");
  const ack = envelope("chunk.ack", 0, { transferId: data.payload.transferId, ackedThrough: 0 }, { requestId: requestId2 });
  assert.equal(target.session.receive(ack).decision, "acceptAck");
  assert.equal(target.session.receive(ack).decision, "rejectLateAck");
});

test("final review: explicit cancel disables open and never partially publishes", () => {
  const target = harness();
  target.session.bootstrap(bootstrap());
  target.session.receive(envelope("document.open", 0, { transferId, utf8ByteLength: 1, sha256: sha("a") }));
  target.session.receive(envelope("chunk.begin", 0, { transferId, purpose: "document.open", totalBytes: 1, chunkBytes: 262_144, totalChunks: 1, sha256: sha("a"), timeoutMs: 10_000 }));
  assert.equal(target.session.cancelTransfer(), true);
  assert.equal(target.replaceCount, 0);
  assert.equal(target.session.phase, "desynced");
  assert.equal(target.editableChanges.at(-1), false);
});

test("mandatory cancel windows: open before begin is terminal and publishes no document", () => {
  const target = harness();
  target.session.bootstrap(bootstrap());
  assert.equal(target.session.receive(envelope("document.open", 0, { transferId, utf8ByteLength: 1, sha256: sha("a") })).decision, "acceptReference");
  assert.equal(target.session.cancelTransfer(), true);
  assert.equal(target.replaceCount, 0);
  assert.equal(target.session.phase, "desynced");
  assert(target.posted.some((message) => message.type === "error" && message.payload.code === "transferCancelled"));
  const replay = target.session.receive(envelope("document.open", 0, { transferId, utf8ByteLength: 1, sha256: sha("a") }));
  assert.equal(replay.decision, "failed");
  assert.equal(replay.outcome, "failed");
  assert.equal(replay.response.type, "error");
  assert.equal(replay.response.payload.code, "transferCancelled");
  assert.equal(target.session.receive(envelope("chunk.begin", 0, { transferId, purpose: "document.open", totalBytes: 1, chunkBytes: 262_144, totalChunks: 1, sha256: sha("a"), timeoutMs: 10_000 })).decision, "rejectNoActiveTransfer");
});

test("terminal open timeout and hash failure replay their cached metadata errors", async () => {
  const timers = [];
  const timeoutTarget = harness({ setTimer: (callback) => { timers.push(callback); return timers.length; }, clearTimer: () => {} });
  timeoutTarget.session.bootstrap(bootstrap());
  const timeoutReference = envelope("document.open", 0, { transferId, utf8ByteLength: 1, sha256: sha("a") });
  timeoutTarget.session.receive(timeoutReference);
  timeoutTarget.session.receive(envelope("chunk.begin", 0, { transferId, purpose: "document.open", totalBytes: 1, chunkBytes: 262_144, totalChunks: 1, sha256: sha("a"), timeoutMs: 10_000 }));
  timers.at(-1)();
  const timeoutReplay = timeoutTarget.session.receive(timeoutReference);
  assert.deepEqual([timeoutReplay.decision, timeoutReplay.outcome, timeoutReplay.response.payload.code], ["failed", "failed", "transferTimeout"]);

  const hashTarget = harness({ hashBytes: () => Promise.reject(new Error("hash unavailable")) });
  hashTarget.session.bootstrap(bootstrap());
  const hashReference = envelope("document.open", 0, { transferId, utf8ByteLength: 1, sha256: sha("a") });
  hashTarget.session.receive(hashReference);
  hashTarget.session.receive(envelope("chunk.begin", 0, { transferId, purpose: "document.open", totalBytes: 1, chunkBytes: 262_144, totalChunks: 1, sha256: sha("a"), timeoutMs: 10_000 }));
  hashTarget.session.receive(envelope("chunk.data", 0, { transferId, index: 0, byteLength: 1, dataBase64: "YQ==" }));
  hashTarget.session.receive(envelope("chunk.end", 0, { transferId, totalBytes: 1, totalChunks: 1, sha256: sha("a") }));
  await hashTarget.session.whenIdle();
  const hashReplay = hashTarget.session.receive(hashReference);
  assert.deepEqual([hashReplay.decision, hashReplay.outcome, hashReplay.response.payload.code], ["failed", "failed", "hashFailed"]);
  assert.equal(JSON.stringify(hashReplay).includes("hash unavailable"), false);
});

test("mandatory cancel windows: open during hash never replaces the document", async () => {
  let finishHash;
  const target = harness({ hashBytes: () => new Promise((resolve) => { finishHash = resolve; }) });
  target.session.bootstrap(bootstrap());
  target.session.receive(envelope("document.open", 0, { transferId, utf8ByteLength: 1, sha256: sha("a") }));
  target.session.receive(envelope("chunk.begin", 0, { transferId, purpose: "document.open", totalBytes: 1, chunkBytes: 262_144, totalChunks: 1, sha256: sha("a"), timeoutMs: 10_000 }));
  target.session.receive(envelope("chunk.data", 0, { transferId, index: 0, byteLength: 1, dataBase64: "YQ==" }));
  target.session.receive(envelope("chunk.end", 0, { transferId, totalBytes: 1, totalChunks: 1, sha256: sha("a") }));
  await Promise.resolve();
  assert.equal(target.session.cancelTransfer(), true);
  finishHash(sha("a"));
  await target.session.whenIdle();
  assert.equal(target.replaceCount, 0);
  assert.equal(target.session.phase, "desynced");
});

test("mandatory cancel windows: snapshot during hash emits no response or chunks", async () => {
  let finishSnapshotHash;
  let hashCalls = 0;
  const target = harness({ hashBytes: (bytes) => {
    hashCalls += 1;
    return hashCalls === 1 ? digest(bytes) : new Promise((resolve) => { finishSnapshotHash = resolve; });
  } });
  await openDocument(target, "private markdown");
  assert.equal(target.session.receive(envelope("document.snapshot.request", 0, { frozenRevision: 0 }, { requestId: requestId2 })).decision, "acceptSnapshot");
  await Promise.resolve();
  assert.equal(target.session.cancelTransfer(), true);
  finishSnapshotHash(sha("private markdown"));
  await target.session.whenIdle();
  assert.equal(target.posted.some((message) => message.requestId === requestId2 && message.type === "document.snapshot.response"), false);
  assert.equal(target.posted.some((message) => message.requestId === requestId2 && message.type.startsWith("chunk.")), false);
  const replay = target.session.receive(envelope("document.snapshot.request", 0, { frozenRevision: 0 }, { requestId: requestId2 }));
  assert.equal(replay.response.type, "error");
  assert.equal(replay.response.payload.code, "transferCancelled");
});
