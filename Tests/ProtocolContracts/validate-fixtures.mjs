import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "Fixtures", "BridgeProtocol", "v1");
const load = async (name) => JSON.parse(await readFile(join(fixtures, name), "utf8"));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = /^[0-9a-f]{64}$/;
const envelopeKeys = ["payload", "protocolVersion", "requestId", "revision", "sessionGeneration", "sessionId", "type"];
const messageTypes = new Set(["editor.ready", "editor.delta", "editor.checkpoint", "document.open", "document.snapshot.request", "document.snapshot.response", "document.saved", "document.saveFailed", "document.externalChange", "theme.set", "chunk.begin", "chunk.data", "chunk.ack", "chunk.end", "error"]);
const exactKeys = (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
const integerAtLeast = (value, minimum) => assert(Number.isSafeInteger(value) && value >= minimum);
const transferReference = (payload) => {
  exactKeys(payload, ["transferId", "utf8ByteLength", "sha256"]);
  assert(uuid.test(payload.transferId));
  integerAtLeast(payload.utf8ByteLength, 0);
  assert(payload.utf8ByteLength <= 16_777_216);
  assert(sha256.test(payload.sha256));
};
const failurePayload = (payload) => {
  assert([2, 3].includes(Object.keys(payload).length));
  assert(typeof payload.code === "string" && payload.code.length > 0);
  assert(typeof payload.message === "string" && payload.message.length > 0);
  if (payload.retryable !== undefined) assert.equal(typeof payload.retryable, "boolean");
  exactKeys(payload, payload.retryable === undefined ? ["code", "message"] : ["code", "message", "retryable"]);
};

function validatePayload(message) {
  const payload = message.payload;
  switch (message.type) {
    case "editor.ready":
      exactKeys(payload, ["capabilities"]);
      assert(Array.isArray(payload.capabilities) && payload.capabilities.every((item) => typeof item === "string"));
      assert.equal(new Set(payload.capabilities).size, payload.capabilities.length);
      break;
    case "editor.delta":
      exactKeys(payload, ["transactionId", "fromRevision", "toRevision", "utf8ByteLength", "sha256"]);
      assert(uuid.test(payload.transactionId));
      integerAtLeast(payload.fromRevision, 0);
      assert.equal(payload.toRevision, payload.fromRevision + 1);
      integerAtLeast(payload.toRevision, 1);
      integerAtLeast(payload.utf8ByteLength, 0);
      assert(payload.utf8ByteLength <= 16_777_216);
      assert.equal(message.revision, payload.toRevision);
      assert(sha256.test(payload.sha256));
      break;
    case "editor.checkpoint":
    case "document.open":
    case "document.snapshot.response":
      transferReference(payload);
      break;
    case "document.snapshot.request":
      exactKeys(payload, ["frozenRevision"]);
      integerAtLeast(payload.frozenRevision, 0);
      assert.equal(message.revision, payload.frozenRevision);
      break;
    case "document.saved":
      exactKeys(payload, ["durableRevision", "sha256"]);
      integerAtLeast(payload.durableRevision, 0);
      assert.equal(message.revision, payload.durableRevision);
      assert(sha256.test(payload.sha256));
      break;
    case "document.saveFailed":
    case "error":
      failurePayload(payload);
      break;
    case "document.externalChange":
      exactKeys(payload, ["kind"]);
      assert(["modified", "moved", "deleted", "permissionLost"].includes(payload.kind));
      break;
    case "theme.set":
      exactKeys(payload, ["appearance"]);
      assert(["light", "dark"].includes(payload.appearance));
      break;
    case "chunk.begin":
      exactKeys(payload, ["transferId", "purpose", "totalBytes", "chunkBytes", "totalChunks", "sha256", "timeoutMs"]);
      assert(uuid.test(payload.transferId));
      assert(["document.open", "document.snapshot.response", "editor.checkpoint"].includes(payload.purpose));
      integerAtLeast(payload.totalBytes, 0);
      assert(payload.totalBytes <= 16_777_216);
      assert(Number.isInteger(payload.chunkBytes) && payload.chunkBytes >= 262_144 && payload.chunkBytes <= 524_288);
      assert.equal(payload.totalChunks, Math.max(1, Math.ceil(payload.totalBytes / payload.chunkBytes)));
      assert(sha256.test(payload.sha256));
      assert(Number.isInteger(payload.timeoutMs) && payload.timeoutMs >= 1 && payload.timeoutMs <= 60_000);
      break;
    case "chunk.data": {
      exactKeys(payload, ["transferId", "index", "byteLength", "dataBase64"]);
      assert(uuid.test(payload.transferId));
      integerAtLeast(payload.index, 0);
      integerAtLeast(payload.byteLength, 0);
      assert(payload.byteLength <= 524_288);
      assert(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.dataBase64));
      assert.equal(Buffer.from(payload.dataBase64, "base64").length, payload.byteLength);
      break;
    }
    case "chunk.ack":
      exactKeys(payload, ["transferId", "ackedThrough"]);
      assert(uuid.test(payload.transferId));
      integerAtLeast(payload.ackedThrough, 0);
      break;
    case "chunk.end":
      exactKeys(payload, ["transferId", "totalBytes", "totalChunks", "sha256"]);
      assert(uuid.test(payload.transferId));
      integerAtLeast(payload.totalBytes, 0);
      assert(payload.totalBytes <= 16_777_216);
      integerAtLeast(payload.totalChunks, 1);
      assert(payload.totalChunks <= 64);
      assert(sha256.test(payload.sha256));
      break;
    default:
      assert.fail(`unknown message type: ${message.type}`);
  }
}

function validateEnvelope(message) {
  assert.equal(message.protocolVersion, 1);
  assert.deepEqual(Object.keys(message).sort(), envelopeKeys);
  assert(messageTypes.has(message.type));
  assert(uuid.test(message.requestId));
  assert(uuid.test(message.sessionId));
  integerAtLeast(message.sessionGeneration, 1);
  integerAtLeast(message.revision, 0);
  assert(message.payload && typeof message.payload === "object" && !Array.isArray(message.payload));
  validatePayload(message);
}

function deltaDecision(test) {
  const { current, candidate } = test;
  if (candidate.sessionId !== current.sessionId) return "rejectWrongSession";
  if (candidate.generation !== current.generation) return candidate.generation < current.generation ? "ignoreRetiredSession" : "rejectWrongSession";
  const prior = test.seen.find((item) => item.transactionId === candidate.transactionId);
  if (prior) return prior.fromRevision === candidate.fromRevision
    && prior.toRevision === candidate.toRevision
    && prior.utf8ByteLength === candidate.utf8ByteLength
    && prior.sha256 === candidate.sha256
    ? "ignoreExactDuplicate"
    : "rejectCheckpointRequired";
  return candidate.fromRevision === current.revision && candidate.toRevision === current.revision + 1 ? "accept" : "rejectCheckpointRequired";
}

function revisionDecision(test) {
  if (test.kind === "delta") return deltaDecision(test);
  if (test.kind === "requestReplay") return test.cached.type === test.candidate.type && test.cached.payloadSha256 === test.candidate.payloadSha256 ? "returnCachedResponse" : "rejectRequestIdConflict";
  if (test.candidate.sessionId !== test.current.sessionId || test.candidate.generation !== test.current.generation) return "rejectWrongSession";
  if (test.kind === "snapshot") {
    if (!test.pending) return "rejectLateTerminalResponse";
    if (test.candidate.requestId !== test.pending.requestId) return "rejectLateTerminalResponse";
    return test.candidate.revision === test.pending.frozenRevision ? "accept" : "rejectRevisionMismatch";
  }
  if (test.kind === "checkpoint") return test.candidate.revision >= test.current.revision && test.candidate.byteLengthValid && test.candidate.hashValid ? "acceptSupersedingCheckpoint" : "rejectCheckpoint";
  if (test.kind === "saved") {
    if (test.candidate.durableRevision > test.current.revision) return "rejectRevisionMismatch";
    return test.candidate.durableRevision === test.current.revision ? "acceptClean" : "acceptDirty";
  }
  throw new Error(`unknown revision case: ${test.kind}`);
}

function validateChunkedBodyPath(messages, operationType) {
  const operationIndex = messages.findIndex((message) => message.type === operationType);
  assert.notEqual(operationIndex, -1, `missing ${operationType}`);
  const operation = messages[operationIndex];
  const transferMessages = messages.filter((message) =>
    message.requestId === operation.requestId
    && message.sessionId === operation.sessionId
    && message.sessionGeneration === operation.sessionGeneration
    && message.revision === operation.revision
    && message.payload.transferId === operation.payload.transferId
  );
  assert.deepEqual(transferMessages.map((message) => message.type), [operationType, "chunk.begin", "chunk.data", "chunk.ack", "chunk.end"]);
  const begin = transferMessages[1];
  assert.equal(begin.payload.purpose, operationType);
  assert.equal(begin.payload.totalBytes, operation.payload.utf8ByteLength);
  assert.equal(begin.payload.sha256, operation.payload.sha256);
  assert.equal(transferMessages.at(-1).payload.sha256, operation.payload.sha256);
}

function bytesFor(event) {
  if (event.dataBase64 !== undefined) return Buffer.from(event.dataBase64, "base64");
  if (event.syntheticByte !== undefined) return Buffer.alloc(event.byteLength, event.syntheticByte);
  return Buffer.alloc(0);
}

function chunkDecision(test, constants) {
  const begin = test.begin;
  if (begin.activeTransferId) return "rejectConcurrentTransfer";
  if (begin.totalBytes > constants.maximumBodyBytes) return "rejectBodyTooLarge";
  if (begin.chunkBytes < constants.minimumChunkBytes || begin.chunkBytes > constants.maximumChunkBytes) return "rejectInvalidChunkSize";
  if (begin.totalChunks !== Math.max(1, Math.ceil(begin.totalBytes / begin.chunkBytes))) return "rejectCountMismatch";
  let expectedIndex = 0;
  let ackedThrough = -1;
  let timedOut = false;
  const chunks = [];
  for (const event of test.events) {
    if (event.kind === "timeout") { timedOut = true; continue; }
    if (timedOut) return "rejectTimeout";
    if (event.transferId !== begin.transferId) return "rejectCrossTransfer";
    if (event.sessionId && (event.sessionId !== begin.sessionId || event.generation !== begin.generation)) return "rejectWrongSession";
    if (event.kind === "data") {
      if (event.index !== expectedIndex) return "rejectOutOfOrder";
      if (event.index > 0 && ackedThrough !== event.index - 1) return "rejectBackpressureViolation";
      const bytes = bytesFor(event);
      if (bytes.length !== event.byteLength) return "rejectLengthMismatch";
      const expectedLength = event.index === begin.totalChunks - 1 ? begin.totalBytes - begin.chunkBytes * event.index : begin.chunkBytes;
      if (event.byteLength !== expectedLength) return "rejectLengthMismatch";
      chunks.push(bytes);
      expectedIndex += 1;
    } else if (event.kind === "ack") {
      if (event.ackedThrough !== expectedIndex - 1) return "rejectOutOfOrder";
      ackedThrough = event.ackedThrough;
    } else if (event.kind === "end") {
      if (expectedIndex !== begin.totalChunks) return "rejectMissingChunk";
      const body = Buffer.concat(chunks);
      if (body.length !== begin.totalBytes) return "rejectLengthMismatch";
      if (createHash("sha256").update(body).digest("hex") !== begin.sha256) return "rejectHashMismatch";
      return "accept";
    }
  }
  return test.expected;
}

const schema = await load("protocol.schema.json");
assert.equal(schema.properties.protocolVersion.const, 1);
assert.equal(schema.$defs.chunkBegin.properties.totalBytes.maximum, 16_777_216);
assert.equal(schema.$defs.chunkBegin.properties.chunkBytes.minimum, 262_144);
assert.equal(schema.$defs.chunkBegin.properties.chunkBytes.maximum, 524_288);
assert.equal(schema.$defs.revision.maximum, Number.MAX_SAFE_INTEGER);
assert.equal(schema.$defs.sessionGeneration.maximum, Number.MAX_SAFE_INTEGER);
assert.equal(schema.properties.sessionId.$ref, "#/$defs/uuid");
assert.equal(schema.properties.sessionGeneration.$ref, "#/$defs/sessionGeneration");
assert.deepEqual(schema.$defs.editorDelta.required, ["transactionId", "fromRevision", "toRevision", "utf8ByteLength", "sha256"]);
assert.equal(schema.$defs.editorDelta.properties.fromRevision.$ref, "#/$defs/revision");
assert.equal(schema.$defs.editorDelta.properties.toRevision.$ref, "#/$defs/revision");
assert.equal(schema.$defs.snapshotRequest.properties.frozenRevision.$ref, "#/$defs/revision");
assert.equal(schema.$defs.saved.properties.durableRevision.$ref, "#/$defs/revision");

const validMessages = await load("valid-messages.json");
const invalidMessages = await load("invalid-messages.json");
for (const message of validMessages) validateEnvelope(message);
for (const fixture of invalidMessages) assert.throws(() => validateEnvelope(fixture.message), undefined, fixture.name);
validateChunkedBodyPath(validMessages, "document.open");
validateChunkedBodyPath(validMessages, "document.snapshot.response");

const transitions = await load("state-transitions.json");
assert.deepEqual(Object.keys(transitions.allowed), transitions.states);
const expectedAllowed = {
  created: ["loading", "closed"],
  loading: ["ready", "saveFailed", "closed"],
  ready: ["editing", "closed"],
  editing: ["snapshotting", "conflict", "closed"],
  snapshotting: ["committing", "conflict", "saveFailed", "closed"],
  committing: ["editing", "conflict", "saveFailed", "closed"],
  conflict: ["closed"],
  saveFailed: ["editing", "closed"],
  closed: []
};
assert.deepEqual(transitions.allowed, expectedAllowed);
let checkedLifecyclePairs = 0;
for (const from of transitions.states) {
  for (const to of transitions.states) {
    assert.equal(transitions.allowed[from].includes(to), expectedAllowed[from].includes(to), `${from} -> ${to}`);
    checkedLifecyclePairs += 1;
  }
}
assert.deepEqual(transitions.allowed.closed, []);
assert.equal(checkedLifecyclePairs, 81);
assert.deepEqual(transitions.newGenerationOnly, [
  { from: "conflict", to: "created", operation: "reloadOrSaveAs" },
  { from: "editing", to: "created", operation: "recoveryOrCleanReload" },
  { from: "saveFailed", to: "created", operation: "reloadOrSaveAs" }
]);

const revisionCases = await load("revision-cases.json");
for (const test of revisionCases) assert.equal(revisionDecision(test), test.expected, test.name);
const chunkFixtures = await load("chunk-cases.json");
for (const test of chunkFixtures.cases) assert.equal(chunkDecision(test, chunkFixtures.constants), test.expected, test.name);

console.log(`PASS bridge protocol v1: schema constants, ${validMessages.length} valid messages, ${invalidMessages.length} invalid messages, ${checkedLifecyclePairs} lifecycle pairs, ${revisionCases.length} revision cases, and ${chunkFixtures.cases.length} chunk cases`);
