import Foundation
import XCTest

@testable import Noto

@MainActor
final class EditorBridgeTests: XCTestCase {
  func testJavaScriptResultParsingIsStrict() throws {
    XCTAssertEqual(
      try EditorJavaScriptResult.decode(["decision": "acceptBootstrap"]),
      EditorJavaScriptResult(decision: "acceptBootstrap", outcome: nil, response: nil))
    XCTAssertThrowsError(
      try EditorJavaScriptResult.decode(["decision": "acceptBootstrap", "extra": true]))
    XCTAssertThrowsError(
      try EditorJavaScriptResult.decode(["decision": "completed", "outcome": "unknown"]))
    XCTAssertThrowsError(try EditorJavaScriptResult.decode(["outcome": "completed"]))
  }

  func testBootstrapRequiresAcceptAndOpenReplaysExactEnvelopeUntilCompleted() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)

    try await driveBridgeToEditing(bridge, transport: transport)

    XCTAssertEqual(transport.bootstrapCalls, 1)
    XCTAssertEqual(bridge.state, .editing)
    XCTAssertEqual(session.state, .editing)
    let opens = transport.messages.filter { $0.type == .documentOpen }
    XCTAssertEqual(opens.count, 2)
    XCTAssertEqual(opens[0], opens[1])
    XCTAssertEqual(transport.messages.filter { $0.type == .chunkEnd }.count, 1)
    await assertThrowsErrorAsync(try await bridge.bootstrap())
  }

  func testRejectedBootstrapAndCachedOpenFailureAreFatal() async throws {
    let firstFixture = try BridgeTemporaryFixture(data: Data())
    let firstSession = makeSession(firstFixture)
    try firstSession.open()
    let rejectedTransport = RecordingEditorTransport()
    rejectedTransport.bootstrapResult = .init(
      decision: "rejectInvalidBootstrap", outcome: nil, response: nil)
    let rejectedBridge = EditorBridge(session: firstSession, transport: rejectedTransport)
    await assertThrowsErrorAsync(try await rejectedBridge.bootstrap())
    XCTAssertEqual(rejectedBridge.state, .desynchronized)

    let secondFixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let secondSession = makeSession(secondFixture)
    try secondSession.open()
    let failedTransport = RecordingEditorTransport()
    failedTransport.handler = { message, occurrence in
      if message.type == .documentOpen, occurrence == 2 {
        let response = try EditorMessage(
          type: .error, requestID: message.requestID, sessionID: message.sessionID,
          sessionGeneration: message.sessionGeneration, revision: message.revision,
          payload: [
            "code": .string("transferHashMismatch"),
            "message": .string("Transfer rejected"),
            "retryable": .bool(false),
          ])
        return .init(decision: "failed", outcome: .failed, response: response)
      }
      return RecordingEditorTransport.defaultResult(for: message, occurrence: occurrence)
    }
    let failedBridge = EditorBridge(session: secondSession, transport: failedTransport)
    try await failedBridge.bootstrap()
    await assertThrowsErrorAsync(
      try await sendReadyAndAcknowledgeOpen(failedBridge, transport: failedTransport))
    XCTAssertEqual(failedBridge.state, .desynchronized)
    XCTAssertEqual(secondSession.state, .ready)
  }

  func testOpenReplayExhaustionIsFatalWithoutBeginningEditing() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    transport.handler = { message, occurrence in
      if message.type == .documentOpen {
        return .init(decision: "acceptReference", outcome: nil, response: nil)
      }
      return RecordingEditorTransport.defaultResult(for: message, occurrence: occurrence)
    }
    let bridge = EditorBridge(session: session, transport: transport, openReplayLimit: 2)
    try await bridge.bootstrap()
    await assertThrowsErrorAsync(
      try await sendReadyAndAcknowledgeOpen(bridge, transport: transport))
    XCTAssertEqual(bridge.state, .desynchronized)
    XCTAssertEqual(session.state, .ready)
  }

  func testRequestSaveRejectionClearsPendingRequest() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    transport.handler = { message, occurrence in
      if message.type == .documentSnapshotRequest {
        return .init(decision: "rejectRevisionMismatch", outcome: nil, response: nil)
      }
      return RecordingEditorTransport.defaultResult(for: message, occurrence: occurrence)
    }
    let bridge = EditorBridge(session: session, transport: transport)
    try await driveBridgeToEditing(bridge, transport: transport)

    await assertThrowsErrorAsync(try await bridge.requestSave())
    await assertThrowsErrorAsync(try await bridge.requestSave())
    XCTAssertEqual(
      transport.messages.filter { $0.type == .documentSnapshotRequest }.count, 2,
      "a rejected request must not leave the bridge permanently busy")
  }

  func testSnapshotRequestTimeoutStartsBeforeChunkBegin() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(
      session: session, transport: transport, operationTimeoutMilliseconds: 20)
    try await driveBridgeToEditing(bridge, transport: transport)
    try await bridge.requestSave()
    try await Task.sleep(for: .milliseconds(60))
    XCTAssertEqual(bridge.state, .desynchronized)
    await assertThrowsErrorAsync(try await bridge.requestSave())
  }

  func testRejectedOpenEndAndSnapshotAckAreFatal() async throws {
    let openFixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let openSession = makeSession(openFixture)
    try openSession.open()
    let openTransport = RecordingEditorTransport()
    openTransport.handler = { message, occurrence in
      if message.type == .chunkEnd {
        return .init(decision: "rejectTransferReferenceMismatch", outcome: nil, response: nil)
      }
      return RecordingEditorTransport.defaultResult(for: message, occurrence: occurrence)
    }
    let openBridge = EditorBridge(session: openSession, transport: openTransport)
    try await openBridge.bootstrap()
    await assertThrowsErrorAsync(
      try await sendReadyAndAcknowledgeOpen(openBridge, transport: openTransport))
    XCTAssertEqual(openBridge.state, .desynchronized)

    let snapshotFixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let snapshotSession = makeSession(snapshotFixture)
    try snapshotSession.open()
    let snapshotTransport = RecordingEditorTransport()
    let snapshotBridge = EditorBridge(session: snapshotSession, transport: snapshotTransport)
    try await driveBridgeToEditing(snapshotBridge, transport: snapshotTransport)
    snapshotTransport.handler = { message, occurrence in
      if message.type == .chunkAck {
        return .init(decision: "rejectLateAck", outcome: nil, response: nil)
      }
      return RecordingEditorTransport.defaultResult(for: message, occurrence: occurrence)
    }
    try await snapshotBridge.requestSave()
    let request = try XCTUnwrap(
      snapshotTransport.messages.last { $0.type == .documentSnapshotRequest })
    await assertThrowsErrorAsync(
      try await beginAndSendSnapshot(
        snapshotBridge, request: request, transferID: UUID(), data: Data("hello".utf8)))
    XCTAssertEqual(snapshotBridge.state, .desynchronized)
    XCTAssertFalse(snapshotTransport.messages.contains { $0.type == .documentSaveFailed })
  }

  func testRevisionGapCancelsSnapshotAndLateFramesCannotWrite() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("disk".utf8))
    let original = try Data(contentsOf: fixture.fileURL)
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)
    try await driveBridgeToEditing(bridge, transport: transport)
    try await bridge.requestSave()
    let request = try XCTUnwrap(transport.messages.last { $0.type == .documentSnapshotRequest })

    let changed = Data("gap".utf8)
    let gap = try editorDelta(bridge, from: 1, to: 2, data: changed)
    await assertThrowsErrorAsync(try await bridge.receive(gap.foundationObject))
    XCTAssertEqual(bridge.state, .desynchronized)

    let reference = try snapshotReference(bridge, request: request, data: changed)
    await assertThrowsErrorAsync(try await bridge.receive(reference.foundationObject))
    XCTAssertEqual(try Data(contentsOf: fixture.fileURL), original)
    XCTAssertFalse(transport.messages.contains { $0.type == .error })
  }

  func testSnapshotRevisionRSavesWhileRPlusOneRemainsDirty() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("zero".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)
    try await driveBridgeToEditing(bridge, transport: transport)
    try await bridge.requestSave()
    let request = try XCTUnwrap(transport.messages.last { $0.type == .documentSnapshotRequest })
    let snapshotData = Data("zero".utf8)
    let transferID = UUID()
    try await beginAndSendSnapshot(
      bridge, request: request, transferID: transferID, data: snapshotData)

    let newer = Data("newer".utf8)
    try await bridge.receive(try editorDelta(bridge, from: 0, to: 1, data: newer).foundationObject)
    try await endSnapshot(bridge, request: request, transferID: transferID, data: snapshotData)

    XCTAssertEqual(try Data(contentsOf: fixture.fileURL), snapshotData)
    XCTAssertEqual(session.editorRevision, 1)
    XCTAssertEqual(session.acceptedRevision, 0)
    XCTAssertTrue(session.isDirty)
    XCTAssertEqual(transport.messages.last?.type, .documentSaved)
  }

  func testExternalModificationDuringSnapshotSaveIsNotOverwritten() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("zero".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)
    try await driveBridgeToEditing(bridge, transport: transport)
    try await bridge.requestSave()
    let request = try XCTUnwrap(transport.messages.last { $0.type == .documentSnapshotRequest })
    let snapshotData = Data("zero".utf8)
    let transferID = UUID()
    try await beginAndSendSnapshot(
      bridge, request: request, transferID: transferID, data: snapshotData)

    let external = Data("external".utf8)
    try external.write(to: fixture.fileURL)
    try await endSnapshot(bridge, request: request, transferID: transferID, data: snapshotData)

    XCTAssertEqual(try Data(contentsOf: fixture.fileURL), external)
    XCTAssertEqual(session.state, .conflict)
    XCTAssertEqual(transport.messages.last?.type, .documentSaveFailed)
    XCTAssertEqual(bridge.state, .editing)
  }

  func testUncorrelatedWebErrorDesynchronizesWithoutNativeErrorSend() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)
    try await driveBridgeToEditing(bridge, transport: transport)
    let error = try EditorMessage(
      type: .error, requestID: UUID(), sessionID: bridge.sessionID,
      sessionGeneration: bridge.sessionGeneration, revision: 0,
      payload: [
        "code": .string("fatal"), "message": .string("fatal"),
        "retryable": .bool(false),
      ])
    try await bridge.receive(error.foundationObject)
    XCTAssertEqual(bridge.state, .desynchronized)
    XCTAssertFalse(transport.messages.contains { $0.type == .error })
  }

  func testInvalidateIsTerminalAndIdempotent() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data())
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)
    bridge.invalidate()
    bridge.invalidate()
    XCTAssertEqual(bridge.state, .invalidated)
    await assertThrowsErrorAsync(try await bridge.bootstrap())
  }

  private func driveBridgeToEditing(
    _ bridge: EditorBridge, transport: RecordingEditorTransport
  ) async throws {
    try await bridge.bootstrap()
    try await sendReadyAndAcknowledgeOpen(bridge, transport: transport)
  }

  private func makeSession(_ fixture: BridgeTemporaryFixture) -> DocumentSession {
    DocumentSession(
      fileURL: fixture.fileURL,
      bookmark: SecurityScopedBookmark(data: Data("bookmark".utf8)),
      fileAccess: CoordinatedFileAccess(coordinator: BridgePassthroughCoordinator()),
      bookmarkResolver: BridgeBookmarkResolver(url: fixture.fileURL),
      scopeAccessor: BridgeScopeAccessor(),
      monitorFactory: { url, handler in ExternalChangeMonitor(url: url, changeHandler: handler) }
    )
  }
}

@MainActor
private func sendReadyAndAcknowledgeOpen(
  _ bridge: EditorBridge, transport: RecordingEditorTransport
) async throws {
  try await bridge.receive(
    try EditorMessage(
      type: .editorReady, requestID: UUID(), sessionID: bridge.sessionID,
      sessionGeneration: bridge.sessionGeneration, revision: 0,
      payload: ["capabilities": .array([.string("chunks-v1"), .string("revision-v1")])]
    ).foundationObject)
  let chunk = try XCTUnwrap(transport.messages.last { $0.type == .chunkData })
  try await bridge.receive(
    try EditorMessage(
      type: .chunkAck, requestID: chunk.requestID, sessionID: bridge.sessionID,
      sessionGeneration: bridge.sessionGeneration, revision: chunk.revision,
      payload: [
        "transferId": try XCTUnwrap(chunk.payload["transferId"]),
        "ackedThrough": try XCTUnwrap(chunk.payload["index"]),
      ]
    ).foundationObject)
}

@MainActor
private func editorDelta(
  _ bridge: EditorBridge, from: UInt64, to: UInt64, data: Data
) throws -> EditorMessage {
  try EditorMessage(
    type: .editorDelta, requestID: UUID(), sessionID: bridge.sessionID,
    sessionGeneration: bridge.sessionGeneration, revision: to,
    payload: [
      "transactionId": .string(UUID().uuidString.lowercased()),
      "fromRevision": .integer(from), "toRevision": .integer(to),
      "utf8ByteLength": .integer(UInt64(data.count)),
      "sha256": .string(ChunkHash.sha256(data)),
    ])
}

@MainActor
private func snapshotReference(
  _ bridge: EditorBridge, request: EditorMessage, data: Data, transferID: UUID = UUID()
) throws -> EditorMessage {
  try EditorMessage(
    type: .documentSnapshotResponse, requestID: request.requestID,
    sessionID: bridge.sessionID, sessionGeneration: bridge.sessionGeneration,
    revision: request.revision,
    payload: [
      "transferId": .string(transferID.uuidString.lowercased()),
      "utf8ByteLength": .integer(UInt64(data.count)),
      "sha256": .string(ChunkHash.sha256(data)),
    ])
}

@MainActor
private func beginAndSendSnapshot(
  _ bridge: EditorBridge, request: EditorMessage, transferID: UUID, data: Data
) async throws {
  try await bridge.receive(
    try snapshotReference(bridge, request: request, data: data, transferID: transferID)
      .foundationObject)
  try await bridge.receive(
    try EditorMessage(
      type: .chunkBegin, requestID: request.requestID, sessionID: bridge.sessionID,
      sessionGeneration: bridge.sessionGeneration, revision: request.revision,
      payload: [
        "transferId": .string(transferID.uuidString.lowercased()),
        "purpose": .string("document.snapshot.response"),
        "totalBytes": .integer(UInt64(data.count)),
        "chunkBytes": .integer(UInt64(EditorProtocolV1.defaultChunkBytes)),
        "totalChunks": .integer(1), "sha256": .string(ChunkHash.sha256(data)),
        "timeoutMs": .integer(10_000),
      ]
    ).foundationObject)
  try await bridge.receive(
    try EditorMessage(
      type: .chunkData, requestID: request.requestID, sessionID: bridge.sessionID,
      sessionGeneration: bridge.sessionGeneration, revision: request.revision,
      payload: [
        "transferId": .string(transferID.uuidString.lowercased()),
        "index": .integer(0), "byteLength": .integer(UInt64(data.count)),
        "dataBase64": .string(data.base64EncodedString()),
      ]
    ).foundationObject)
}

@MainActor
private func endSnapshot(
  _ bridge: EditorBridge, request: EditorMessage, transferID: UUID, data: Data
) async throws {
  try await bridge.receive(
    try EditorMessage(
      type: .chunkEnd, requestID: request.requestID, sessionID: bridge.sessionID,
      sessionGeneration: bridge.sessionGeneration, revision: request.revision,
      payload: [
        "transferId": .string(transferID.uuidString.lowercased()),
        "totalBytes": .integer(UInt64(data.count)), "totalChunks": .integer(1),
        "sha256": .string(ChunkHash.sha256(data)),
      ]
    ).foundationObject)
}

@MainActor
private final class RecordingEditorTransport: EditorJavaScriptTransport {
  private(set) var bootstrapCalls = 0
  private(set) var messages: [EditorMessage] = []
  var bootstrapResult = EditorJavaScriptResult(
    decision: "acceptBootstrap", outcome: nil, response: nil)
  var handler: ((EditorMessage, Int) throws -> EditorJavaScriptResult)?
  private var occurrences: [EditorMessageType: Int] = [:]

  func bootstrap(sessionID: UUID, generation: UInt64) async throws -> EditorJavaScriptResult {
    bootstrapCalls += 1
    return bootstrapResult
  }

  func receive(_ message: EditorMessage) async throws -> EditorJavaScriptResult {
    messages.append(message)
    occurrences[message.type, default: 0] += 1
    let occurrence = occurrences[message.type, default: 0]
    return try handler?(message, occurrence)
      ?? Self.defaultResult(for: message, occurrence: occurrence)
  }

  static func defaultResult(
    for message: EditorMessage, occurrence: Int
  ) -> EditorJavaScriptResult {
    switch message.type {
    case .documentOpen:
      return .init(
        decision: occurrence == 1 ? "acceptReference" : "completed",
        outcome: occurrence == 1 ? nil : .completed, response: nil)
    case .chunkBegin: return .init(decision: "acceptBegin", outcome: nil, response: nil)
    case .chunkData: return .init(decision: "acceptChunk", outcome: nil, response: nil)
    case .chunkEnd:
      return .init(decision: "acceptEndPendingValidation", outcome: nil, response: nil)
    case .chunkAck: return .init(decision: "acceptAck", outcome: nil, response: nil)
    case .documentSnapshotRequest:
      return .init(decision: "acceptSnapshot", outcome: nil, response: nil)
    case .documentSaved: return .init(decision: "acceptDirty", outcome: nil, response: nil)
    case .documentSaveFailed:
      return .init(decision: "acceptSaveFailure", outcome: nil, response: nil)
    default: return .init(decision: "accept", outcome: nil, response: nil)
    }
  }
}

private struct BridgeBookmarkResolver: BookmarkDataResolving {
  let url: URL
  func createBookmark(for url: URL) throws -> Data { Data() }
  func resolveBookmark(_ data: Data) throws -> (url: URL, isStale: Bool) { (url, false) }
}

private struct BridgeScopeAccessor: SecurityScopeAccessing {
  func startAccessing(_ url: URL) -> Bool { true }
  func stopAccessing(_ url: URL) {}
}

private struct BridgePassthroughCoordinator: FileCoordinating {
  func coordinateReading<T>(at url: URL, _ accessor: (URL) throws -> T) throws -> T {
    try accessor(url)
  }
  func coordinateWriting<T>(at url: URL, _ accessor: (URL) throws -> T) throws -> T {
    try accessor(url)
  }
}

private final class BridgeTemporaryFixture {
  let directoryURL: URL
  let fileURL: URL

  init(data: Data) throws {
    directoryURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    fileURL = directoryURL.appendingPathComponent("fixture.md")
    try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    try data.write(to: fileURL)
  }

  deinit { try? FileManager.default.removeItem(at: directoryURL) }
}

@MainActor
private func assertThrowsErrorAsync<T>(
  _ expression: @autoclosure () async throws -> T,
  file: StaticString = #filePath,
  line: UInt = #line
) async {
  do {
    _ = try await expression()
    XCTFail("Expected error", file: file, line: line)
  } catch {}
}
