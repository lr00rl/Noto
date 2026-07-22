import Foundation
import XCTest

@testable import Noto

@MainActor
final class EditorBridgeTests: XCTestCase {
  func testBootstrapReadyAndOpenAreExactlyOnce() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)

    try await bridge.bootstrap()
    XCTAssertEqual(transport.bootstrapCalls, 1)
    await assertThrowsErrorAsync(try await bridge.bootstrap())

    try await bridge.receive(
      try EditorMessage(
        type: .editorReady, requestID: UUID(), sessionID: bridge.sessionID,
        sessionGeneration: bridge.sessionGeneration, revision: 0,
        payload: ["capabilities": .array([.string("chunks-v1"), .string("revision-v1")])]
      ).foundationObject)

    XCTAssertEqual(transport.messages.filter { $0.type == .documentOpen }.count, 1)
    XCTAssertEqual(transport.messages.filter { $0.type == .chunkBegin }.count, 1)
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

    XCTAssertEqual(bridge.state, .editing)
    XCTAssertEqual(session.state, .editing)
    XCTAssertEqual(transport.messages.filter { $0.type == .chunkEnd }.count, 1)
  }

  func testDeltaUpdatesMetadataWithoutCopyingLiveTextIntoDocumentSession() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let session = makeSession(fixture)
    try session.open()
    try session.beginEditing()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)
    // Drive state through the real bootstrap/open sequence in the first test; this assertion locks
    // the authority boundary directly at DocumentSession's metadata API.
    let changed = Data("changed".utf8)
    try session.recordEditorDelta(
      transactionID: UUID(), fromRevision: 0, toRevision: 1,
      utf8ByteLength: changed.count, sha256: ChunkHash.sha256(changed))

    XCTAssertEqual(session.editorRevision, 1)
    XCTAssertTrue(session.isDirty)
    XCTAssertEqual(session.text, "hello")
    bridge.invalidate()
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

  func testUnrelatedErrorDoesNotClearPendingSaveRequest() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)

    // The bridge must retain the outstanding snapshot request when an unrelated error arrives.
    // A second save request therefore remains invalid until the correlated request completes.
    try await driveBridgeToEditing(bridge, transport: transport)
    try await bridge.requestSave()
    let unrelated = try EditorMessage(
      type: .error, requestID: UUID(), sessionID: bridge.sessionID,
      sessionGeneration: bridge.sessionGeneration, revision: session.editorRevision,
      payload: [
        "code": .string("unrelated"),
        "message": .string("unrelated request"),
        "retryable": .bool(false),
      ])
    await assertThrowsErrorAsync(try await bridge.receive(unrelated.foundationObject))
    await assertThrowsErrorAsync(try await bridge.requestSave())
  }

  private func driveBridgeToEditing(
    _ bridge: EditorBridge, transport: RecordingEditorTransport
  ) async throws {
    try await bridge.bootstrap()
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
private final class RecordingEditorTransport: EditorJavaScriptTransport {
  private(set) var bootstrapCalls = 0
  private(set) var messages: [EditorMessage] = []

  func bootstrap(sessionID: UUID, generation: UInt64) async throws {
    bootstrapCalls += 1
  }

  func receive(_ message: EditorMessage) async throws {
    messages.append(message)
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
