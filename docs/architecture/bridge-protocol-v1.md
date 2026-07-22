# Noto Bridge Protocol v1

Status: frozen for Ultragoal `G001-bootstrap-and-protocol`.

This document is the language-neutral contract between the AppKit host and the bundled TypeScript editor. The JSON fixtures in `Tests/Fixtures/BridgeProtocol/v1` are the executable source of truth. Neither side may accept a fixture that the other rejects.

## Envelope

Every message is a UTF-8 JSON object with these required fields:

| Field | Contract |
| --- | --- |
| `protocolVersion` | Integer `1`; all other versions are rejected. |
| `type` | A closed message-type string from `protocol.schema.json`. |
| `requestId` | Non-empty UUID, unique within a document session. |
| `sessionId` | Non-empty UUID identifying a document session. |
| `sessionGeneration` | Positive integer. Reload, recovery, or Save As creates a new generation; messages from retired generations are ignored and logged. |
| `revision` | Non-negative integer naming the editor revision relevant to the message. |
| `payload` | Type-specific object; unknown properties are rejected. |

Unknown message types, unknown fields, malformed payloads, and envelopes larger than the receiving implementation's bounded control-message limit are rejected before state mutation. Diagnostics may record IDs, revisions, lengths, hashes, and error codes, but never Markdown content.

## Lifecycle

The same-session lifecycle is:

```text
created -> loading -> ready -> editing -> snapshotting -> committing
                                                    \-> editing
                                                    \-> conflict
                                                    \-> saveFailed -> editing
any non-closed state ------------------------------------------> closed
```

`closed` is terminal. Reload, recovery, or Save As does not transition a conflicting session back to `created`; it retires the old generation and creates a new session generation. The exhaustive transition matrix is in `state-transitions.json`.

Only a message valid for the current lifecycle state, active session ID/generation, and pending request/transfer may mutate state. Late messages for a closed or retired session are ignored and logged.

## Request replay

Request IDs are unique per session generation. Receivers cache the terminal outcome and a canonical payload hash:

- exact request ID plus identical type and payload hash: return the cached terminal response without repeating side effects;
- same request ID with a different type or payload hash: reject as `requestIdConflict`;
- a terminal response for no pending request: reject as `lateTerminalResponse`.

## Revisions and deltas

Revisions are monotonically increasing within a session generation.

- A new delta is accepted only when `fromRevision` equals the current revision and `toRevision` is `fromRevision + 1`.
- An already accepted `transactionId` with the same from/to revisions and content hash is an idempotent duplicate and is ignored.
- A conflicting duplicate, stale non-duplicate, future revision, or gap is rejected with `checkpointRequired`; the receiver must not skip forward.
- A checkpoint supersedes prior deltas only after its session generation, revision, byte length, and SHA-256 validate.
- A snapshot response is accepted only for the one pending request and its frozen revision. Editing past that revision does not make an older response current or saved.
- Dirty state clears only after durable commit of the matching revision and `document.saved` for that revision.

The executable decision vectors are in `revision-cases.json`.

## Bounded chunk transfer

Large open and snapshot bodies use `chunk.begin`, ordered `chunk.data`, `chunk.ack`, and `chunk.end` messages.

Constants:

- maximum UTF-8 body: `16,777,216` bytes (16 MiB);
- negotiated `chunkBytes`: `262,144` through `524,288` bytes (256-512 KiB); v1 fixtures use 256 KiB;
- at most one active open or snapshot transfer per session generation;
- `totalChunks = max(1, ceil(totalBytes / chunkBytes))`;
- SHA-256 is lowercase 64-character hexadecimal over the complete UTF-8 byte sequence.

Transfer algorithm:

1. Sender emits `chunk.begin` with transfer ID, purpose, total bytes, chunk size, total chunks, and full-body SHA-256.
2. Receiver rejects the begin frame before allocation if the size, count, hash, session, revision, request, or concurrency checks fail.
3. Sender emits exactly the next zero-based `chunk.data` only after the receiver acknowledged the preceding index. This one-chunk window is mandatory backpressure.
4. Receiver verifies transfer identity, index, declared byte length, per-position byte budget, and cumulative byte budget before retaining data, then returns `chunk.ack` with `ackedThrough` equal to that index.
5. `chunk.end` is accepted only after all chunks arrive. The receiver assembles into a temporary buffer, verifies final byte count and SHA-256, then atomically publishes the body to the editor or save pipeline.

Duplicate, out-of-order, missing, late, cross-transfer, cross-session, unacknowledged-window, timed-out, count-mismatched, length-mismatched, hash-mismatched, or oversized transfers fail explicitly. Failure discards the temporary assembly and never partially updates editor or file state.

## Shared artifacts

- `protocol.schema.json`: structural JSON Schema for envelopes and typed payloads.
- `valid-messages.json` / `invalid-messages.json`: decoder agreement fixtures.
- `state-transitions.json`: exhaustive lifecycle matrix.
- `revision-cases.json`: session, request replay, delta, checkpoint, and snapshot decisions.
- `chunk-cases.json`: size, order, backpressure, timeout, count, length, and hash decisions.
- `Tests/ProtocolContracts/validate-fixtures.mjs`: dependency-free reference validation and fixture self-test.

Swift and TypeScript tests must load these same fixture files rather than maintaining copied expectations.
