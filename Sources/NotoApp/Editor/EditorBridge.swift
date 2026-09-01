import Foundation
import WebKit

struct EditorJavaScriptResult: Equatable, Sendable {
  enum Outcome: String, Sendable {
    case inFlight
    case completed
    case failed
  }

  let decision: String
  let outcome: Outcome?
  let response: EditorMessage?

  static func decode(_ value: Any?) throws -> Self {
    let object: [String: Any]
    if let dictionary = value as? [String: Any] {
      object = dictionary
    } else if let json = value as? String {
      let decoded: Any
      do {
        decoded = try JSONSerialization.jsonObject(with: Data(json.utf8))
      } catch {
        throw EditorBridgeError.invalidJavaScriptResult
      }
      guard let dictionary = decoded as? [String: Any] else {
        throw EditorBridgeError.invalidJavaScriptResult
      }
      object = dictionary
    } else {
      throw EditorBridgeError.invalidJavaScriptResult
    }
    let allowed = Set(["decision", "outcome", "response"])
    guard Set(object.keys).isSubset(of: allowed), let decision = object["decision"] as? String,
      !decision.isEmpty
    else { throw EditorBridgeError.invalidJavaScriptResult }

    let outcome: Outcome?
    if let rawOutcome = object["outcome"] {
      guard let raw = rawOutcome as? String, let parsed = Outcome(rawValue: raw) else {
        throw EditorBridgeError.invalidJavaScriptResult
      }
      outcome = parsed
    } else {
      outcome = nil
    }

    let response: EditorMessage?
    if let rawResponse = object["response"] {
      response = try EditorProtocolCodec.decode(rawResponse)
    } else {
      response = nil
    }
    return Self(decision: decision, outcome: outcome, response: response)
  }
}

@MainActor
protocol EditorJavaScriptTransport: AnyObject {
  func bootstrap(sessionID: UUID, generation: UInt64) async throws -> EditorJavaScriptResult
  func receive(_ message: EditorMessage) async throws -> EditorJavaScriptResult
}

@MainActor
final class WebKitEditorJavaScriptTransport: EditorJavaScriptTransport {
  weak var webView: WKWebView?

  init(webView: WKWebView? = nil) {
    self.webView = webView
  }

  func bootstrap(sessionID: UUID, generation: UInt64) async throws -> EditorJavaScriptResult {
    guard let webView else { throw EditorBridgeError.transportUnavailable }
    var bridgeAvailable = false
    for _ in 0..<200 {
      let raw = try await webView.callAsyncJavaScript(
        "return JSON.stringify({decision: typeof globalThis.notoBridge?.bootstrap === 'function' ? 'bridgeReady' : 'bridgeWaiting'})",
        arguments: [:],
        in: nil,
        contentWorld: .page
      )
      if try EditorJavaScriptResult.decode(raw).decision == "bridgeReady" {
        bridgeAvailable = true
        break
      }
      try await Task.sleep(for: .milliseconds(10))
    }
    guard bridgeAvailable else { throw EditorBridgeError.transportUnavailable }
    let raw = try await webView.callAsyncJavaScript(
      "return JSON.stringify(globalThis.notoBridge.bootstrap(command))",
      arguments: [
        "command": [
          "command": "bootstrap",
          "sessionId": sessionID.uuidString.lowercased(),
          "sessionGeneration": NSNumber(value: generation),
        ]
      ],
      in: nil,
      contentWorld: .page
    )
    return try EditorJavaScriptResult.decode(raw)
  }

  func receive(_ message: EditorMessage) async throws -> EditorJavaScriptResult {
    guard let webView else { throw EditorBridgeError.transportUnavailable }
    let raw = try await webView.callAsyncJavaScript(
      "return JSON.stringify(globalThis.notoBridge.receive(message))",
      arguments: ["message": message.foundationObject],
      in: nil,
      contentWorld: .page
    )
    return try EditorJavaScriptResult.decode(raw)
  }
}

enum EditorBridgeError: Error, Equatable, Sendable {
  case transportUnavailable
  case invalidJavaScriptResult
  case rejected(String)
  case invalidState
  case wrongSession
  case futureGeneration
  case unexpectedMessage
  case desynchronized
  case invalidated
}

@MainActor
final class EditorBridge {
  enum State: Equatable, Sendable {
    case created
    case awaitingReady
    case opening
    case editing
    case desynchronized
    case invalidated
  }

  private(set) var state: State = .created
  let sessionID: UUID
  let sessionGeneration: UInt64

  private let session: DocumentSession
  private weak var transport: (any EditorJavaScriptTransport)?
  private let operationTimeoutMilliseconds: Int
  private let openReplayLimit: Int
  private let openReplayDelayMilliseconds: Int
  private let onFatal: (@MainActor () -> Void)?
  private var openTransfer: OutboundChunkTransfer?
  private var openMessage: EditorMessage?
  private var openRequestID: UUID?
  private var openOperationToken: UUID?
  private var incomingSnapshot: InboundChunkTransfer?
  private var pendingSnapshotReference: (transferID: UUID, byteCount: Int, sha256: String)?
  private var pendingSnapshotRequestID: UUID?
  private var pendingSnapshotRevision: UInt64?
  private var openTimeoutTask: Task<Void, Never>?
  private var snapshotTimeoutTask: Task<Void, Never>?
  private var readyAccepted = false
  private var openStarted = false

  init(
    session: DocumentSession,
    transport: any EditorJavaScriptTransport,
    sessionID: UUID = UUID(),
    sessionGeneration: UInt64 = 1,
    operationTimeoutMilliseconds: Int = 10_000,
    openReplayLimit: Int = 128,
    openReplayDelayMilliseconds: Int = 10,
    onFatal: (@MainActor () -> Void)? = nil
  ) {
    self.session = session
    self.transport = transport
    self.sessionID = sessionID
    self.sessionGeneration = sessionGeneration
    self.operationTimeoutMilliseconds = operationTimeoutMilliseconds
    self.openReplayLimit = openReplayLimit
    self.openReplayDelayMilliseconds = openReplayDelayMilliseconds
    self.onFatal = onFatal
  }

  func bootstrap() async throws {
    guard state == .created else { throw EditorBridgeError.invalidState }
    state = .awaitingReady
    do {
      let result = try await requireTransport().bootstrap(
        sessionID: sessionID, generation: sessionGeneration)
      try require(result, decisions: ["acceptBootstrap"])
    } catch {
      enterDesynchronized()
      throw error
    }
  }

  func requestSave() async throws {
    guard state == .editing, pendingSnapshotRequestID == nil else {
      throw EditorBridgeError.invalidState
    }
    let requestID = UUID()
    let revision = session.editorRevision
    pendingSnapshotRequestID = requestID
    pendingSnapshotRevision = revision
    startSnapshotTimeout(requestID: requestID, revision: revision)
    do {
      let result = try await send(
        .documentSnapshotRequest, requestID: requestID, revision: revision,
        payload: ["frozenRevision": .integer(revision)])
      try require(result, decisions: ["acceptSnapshot"], responseType: .documentSnapshotResponse)
      if let response = result.response { try receiveSnapshotReference(response) }
    } catch {
      failPendingSnapshot()
      throw error
    }
  }

  func receive(_ body: Any) async throws {
    guard state != .invalidated else { throw EditorBridgeError.invalidated }
    guard state != .desynchronized else { throw EditorBridgeError.desynchronized }
    let message = try EditorProtocolCodec.decode(body)
    guard message.sessionID == sessionID else { throw EditorBridgeError.wrongSession }
    if message.sessionGeneration < sessionGeneration { return }
    guard message.sessionGeneration == sessionGeneration else {
      enterDesynchronized()
      throw EditorBridgeError.futureGeneration
    }

    do {
      switch message.type {
      case .editorReady:
        try await receiveReady(message)
      case .editorDelta:
        try receiveDelta(message)
      case .documentSnapshotResponse:
        try receiveSnapshotReference(message)
      case .chunkBegin:
        try receiveChunkBegin(message)
      case .chunkData:
        try await receiveChunkData(message)
      case .chunkAck:
        try await receiveChunkAcknowledgement(message)
      case .chunkEnd:
        try await receiveChunkEnd(message)
      case .error:
        receiveWebError(message)
      default:
        throw EditorBridgeError.unexpectedMessage
      }
    } catch {
      if state == .opening || (isPendingSnapshot(message) && message.type != .error) {
        enterDesynchronized()
      }
      throw error
    }
  }

  func invalidate() {
    guard state != .invalidated else { return }
    cancelPendingOperations()
    transport = nil
    state = .invalidated
  }

  private func receiveReady(_ message: EditorMessage) async throws {
    guard state == .awaitingReady, !readyAccepted, !openStarted, message.revision == 0 else {
      throw EditorBridgeError.unexpectedMessage
    }
    readyAccepted = true
    openStarted = true
    state = .opening
    let body = Data(session.text.utf8)
    let identity = ChunkTransferIdentity(
      requestID: UUID(), sessionID: sessionID, sessionGeneration: sessionGeneration,
      revision: 0, transferID: UUID())
    let transfer = try OutboundChunkTransfer(
      identity: identity, purpose: "document.open", body: body)
    let message = try makeMessage(
      .documentOpen, requestID: identity.requestID, revision: 0,
      payload: [
        "transferId": .string(identity.transferID.uuidString.lowercased()),
        "utf8ByteLength": .integer(UInt64(body.count)),
        "sha256": .string(transfer.descriptor.sha256),
      ])
    openTransfer = transfer
    openMessage = message
    openRequestID = identity.requestID
    openOperationToken = UUID()
    startOpenTimeout(transfer)
    do {
      try require(try await requireTransport().receive(message), decisions: ["acceptReference"])
      try await sendBegin(transfer.descriptor)
      try await sendNextOpenChunk()
    } catch {
      enterDesynchronized()
      throw error
    }
  }

  private func receiveDelta(_ message: EditorMessage) throws {
    guard state == .editing,
      case .string(let transaction) = message.payload["transactionId"],
      let transactionID = UUID(uuidString: transaction),
      case .integer(let from) = message.payload["fromRevision"],
      case .integer(let to) = message.payload["toRevision"],
      case .integer(let byteLength) = message.payload["utf8ByteLength"],
      case .string(let sha256) = message.payload["sha256"]
    else { throw EditorBridgeError.unexpectedMessage }
    do {
      try session.recordEditorDelta(
        transactionID: transactionID, fromRevision: from, toRevision: to,
        utf8ByteLength: Int(byteLength), sha256: sha256)
      openRequestID = nil
    } catch {
      enterDesynchronized()
      throw EditorBridgeError.desynchronized
    }
  }

  private func receiveSnapshotReference(_ message: EditorMessage) throws {
    guard state == .editing, message.requestID == pendingSnapshotRequestID,
      message.revision == pendingSnapshotRevision,
      message.revision >= session.acceptedRevision,
      case .string(let transfer) = message.payload["transferId"],
      let transferID = UUID(uuidString: transfer),
      case .integer(let byteCount) = message.payload["utf8ByteLength"],
      case .string(let sha256) = message.payload["sha256"], pendingSnapshotReference == nil
    else { throw EditorBridgeError.unexpectedMessage }
    pendingSnapshotReference = (transferID, Int(byteCount), sha256)
  }

  private func receiveChunkBegin(_ message: EditorMessage) throws {
    guard state == .editing, incomingSnapshot == nil, let reference = pendingSnapshotReference,
      message.requestID == pendingSnapshotRequestID,
      message.revision == pendingSnapshotRevision,
      case .string(let transfer) = message.payload["transferId"],
      let transferID = UUID(uuidString: transfer),
      case .string(let purpose) = message.payload["purpose"],
      purpose == "document.snapshot.response",
      case .integer(let totalBytes) = message.payload["totalBytes"],
      case .integer(let chunkBytes) = message.payload["chunkBytes"],
      case .integer(let totalChunks) = message.payload["totalChunks"],
      case .string(let sha256) = message.payload["sha256"],
      case .integer(let timeout) = message.payload["timeoutMs"],
      transferID == reference.transferID, Int(totalBytes) == reference.byteCount,
      sha256 == reference.sha256
    else { throw EditorBridgeError.unexpectedMessage }
    let descriptor = try ChunkTransferDescriptor(
      identity: ChunkTransferIdentity(
        requestID: message.requestID, sessionID: sessionID,
        sessionGeneration: sessionGeneration, revision: message.revision, transferID: transferID),
      purpose: purpose, totalBytes: Int(totalBytes), chunkBytes: Int(chunkBytes),
      totalChunks: Int(totalChunks), sha256: sha256, timeoutMilliseconds: Int(timeout))
    incomingSnapshot = InboundChunkTransfer(descriptor: descriptor)
  }

  private func receiveChunkData(_ message: EditorMessage) async throws {
    guard state == .editing, let transfer = incomingSnapshot,
      case .string(let transferString) = message.payload["transferId"],
      let transferID = UUID(uuidString: transferString),
      case .integer(let index) = message.payload["index"],
      case .integer(let byteLength) = message.payload["byteLength"],
      case .string(let dataBase64) = message.payload["dataBase64"]
    else { throw EditorBridgeError.unexpectedMessage }
    let identity = ChunkTransferIdentity(
      requestID: message.requestID, sessionID: sessionID, sessionGeneration: sessionGeneration,
      revision: message.revision, transferID: transferID)
    let acknowledged = try transfer.receive(
      ChunkDataFrame(
        identity: identity, index: Int(index), byteLength: Int(byteLength),
        dataBase64: dataBase64))
    let result = try await send(
      .chunkAck, requestID: message.requestID, revision: message.revision,
      payload: [
        "transferId": .string(transferID.uuidString.lowercased()),
        "ackedThrough": .integer(UInt64(acknowledged)),
      ])
    try require(result, decisions: ["acceptAck"])
    try transfer.didSendAcknowledgement(through: acknowledged)
  }

  private func receiveChunkAcknowledgement(_ message: EditorMessage) async throws {
    guard state == .opening, let transfer = openTransfer,
      case .string(let transferString) = message.payload["transferId"],
      let transferID = UUID(uuidString: transferString),
      case .integer(let acknowledged) = message.payload["ackedThrough"]
    else { throw EditorBridgeError.unexpectedMessage }
    let identity = ChunkTransferIdentity(
      requestID: message.requestID, sessionID: sessionID, sessionGeneration: sessionGeneration,
      revision: message.revision, transferID: transferID)
    try transfer.acknowledge(identity: identity, through: Int(acknowledged))
    try await sendNextOpenChunk()
  }

  private func sendNextOpenChunk() async throws {
    guard state == .opening, let transfer = openTransfer else {
      throw EditorBridgeError.invalidState
    }
    if let frame = try transfer.nextFrame() {
      let result = try await send(
        .chunkData, requestID: frame.identity.requestID, revision: frame.identity.revision,
        payload: [
          "transferId": .string(frame.identity.transferID.uuidString.lowercased()),
          "index": .integer(UInt64(frame.index)),
          "byteLength": .integer(UInt64(frame.byteLength)),
          "dataBase64": .string(frame.dataBase64),
        ])
      try require(result, decisions: ["acceptChunk"])
      return
    }
    let end = try transfer.endFrame()
    let result = try await sendEnd(end)
    try require(result, decisions: ["acceptEndPendingValidation"])
    try await replayOpenUntilTerminal()
  }

  private func replayOpenUntilTerminal() async throws {
    guard let message = openMessage, let operationToken = openOperationToken else {
      throw EditorBridgeError.invalidState
    }
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: .milliseconds(operationTimeoutMilliseconds))
    for attempt in 0..<openReplayLimit {
      guard isCurrentOpen(message, operationToken: operationToken), clock.now < deadline else {
        throw EditorBridgeError.desynchronized
      }
      let delay = min(openReplayDelayMilliseconds * (attempt + 1), 100)
      try await Task.sleep(for: .milliseconds(delay))
      guard isCurrentOpen(message, operationToken: operationToken), clock.now < deadline else {
        throw EditorBridgeError.desynchronized
      }
      let result = try await requireTransport().receive(message)
      guard isCurrentOpen(message, operationToken: operationToken), clock.now < deadline else {
        throw EditorBridgeError.desynchronized
      }
      switch result.decision {
      case "acceptReference":
        try require(result, decisions: ["acceptReference"])
      case "completed":
        try require(result, decisions: ["completed"], outcome: .completed)
        completeOpen()
        return
      case "failed":
        try require(result, decisions: ["failed"], outcome: .failed, responseType: .error)
        guard let response = result.response, response.requestID == message.requestID,
          response.revision == message.revision
        else { throw EditorBridgeError.invalidJavaScriptResult }
        enterDesynchronized()
        throw EditorBridgeError.desynchronized
      default:
        throw EditorBridgeError.rejected(result.decision)
      }
    }
    enterDesynchronized()
    throw EditorBridgeError.desynchronized
  }

  private func completeOpen() {
    openTimeoutTask?.cancel()
    openTimeoutTask = nil
    openTransfer = nil
    openMessage = nil
    openOperationToken = nil
    try? session.beginEditing()
    state = session.state == .editing ? .editing : .desynchronized
  }

  private func receiveChunkEnd(_ message: EditorMessage) async throws {
    guard state == .editing, let transfer = incomingSnapshot,
      case .string(let transferString) = message.payload["transferId"],
      let transferID = UUID(uuidString: transferString),
      case .integer(let totalBytes) = message.payload["totalBytes"],
      case .integer(let totalChunks) = message.payload["totalChunks"],
      case .string(let sha256) = message.payload["sha256"]
    else { throw EditorBridgeError.unexpectedMessage }
    let identity = ChunkTransferIdentity(
      requestID: message.requestID, sessionID: sessionID, sessionGeneration: sessionGeneration,
      revision: message.revision, transferID: transferID)
    let body = try transfer.finish(
      ChunkEndFrame(
        identity: identity, totalBytes: Int(totalBytes), totalChunks: Int(totalChunks),
        sha256: sha256))
    incomingSnapshot = nil
    let snapshot = try VerifiedDocumentSnapshot(
      revision: message.revision, data: body, sha256: sha256)
    do {
      try session.save(snapshot: snapshot)
    } catch let saveError {
      let requestID = message.requestID
      let revision = message.revision
      let externalConflict = saveError as? DocumentSessionError == .externalChange
      let result = try await send(
        .documentSaveFailed, requestID: requestID, revision: revision,
        payload: [
          "code": .string("replaceFailed"), "message": .string("Atomic replacement failed"),
          "retryable": .bool(true),
        ])
      try require(result, decisions: ["acceptSaveFailure"])
      failPendingSnapshot()
      if externalConflict { enterDesynchronized() }
      return
    }

    let result: EditorJavaScriptResult
    do {
      result = try await send(
        .documentSaved, requestID: message.requestID, revision: message.revision,
        payload: [
          "durableRevision": .integer(message.revision), "sha256": .string(sha256),
        ])
      try require(result, decisions: ["acceptClean", "acceptDirty"])
      failPendingSnapshot()
    } catch {
      failPendingSnapshot()
      enterDesynchronized()
      throw error
    }
  }

  private func receiveWebError(_ message: EditorMessage) {
    if message.requestID == openRequestID
      || (message.requestID == pendingSnapshotRequestID
        && message.revision == pendingSnapshotRevision)
    {
      enterDesynchronized()
      return
    }
    enterDesynchronized()
  }

  private func sendBegin(_ descriptor: ChunkTransferDescriptor) async throws {
    let result = try await send(
      .chunkBegin, requestID: descriptor.identity.requestID, revision: descriptor.identity.revision,
      payload: [
        "transferId": .string(descriptor.identity.transferID.uuidString.lowercased()),
        "purpose": .string(descriptor.purpose),
        "totalBytes": .integer(UInt64(descriptor.totalBytes)),
        "chunkBytes": .integer(UInt64(descriptor.chunkBytes)),
        "totalChunks": .integer(UInt64(descriptor.totalChunks)),
        "sha256": .string(descriptor.sha256),
        "timeoutMs": .integer(UInt64(descriptor.timeoutMilliseconds)),
      ])
    try require(result, decisions: ["acceptBegin"])
  }

  private func sendEnd(_ frame: ChunkEndFrame) async throws -> EditorJavaScriptResult {
    try await send(
      .chunkEnd, requestID: frame.identity.requestID, revision: frame.identity.revision,
      payload: [
        "transferId": .string(frame.identity.transferID.uuidString.lowercased()),
        "totalBytes": .integer(UInt64(frame.totalBytes)),
        "totalChunks": .integer(UInt64(frame.totalChunks)), "sha256": .string(frame.sha256),
      ])
  }

  private func send(
    _ type: EditorMessageType, requestID: UUID, revision: UInt64,
    payload: [String: JSONValue]
  ) async throws -> EditorJavaScriptResult {
    try await requireTransport().receive(
      makeMessage(type, requestID: requestID, revision: revision, payload: payload))
  }

  private func makeMessage(
    _ type: EditorMessageType, requestID: UUID, revision: UInt64,
    payload: [String: JSONValue]
  ) throws -> EditorMessage {
    try EditorMessage(
      type: type, requestID: requestID, sessionID: sessionID,
      sessionGeneration: sessionGeneration, revision: revision, payload: payload)
  }

  private func require(
    _ result: EditorJavaScriptResult, decisions: Set<String>,
    outcome: EditorJavaScriptResult.Outcome? = nil,
    responseType: EditorMessageType? = nil
  ) throws {
    guard decisions.contains(result.decision), result.outcome == outcome else {
      throw EditorBridgeError.rejected(result.decision)
    }
    if let responseType {
      if let response = result.response {
        guard response.type == responseType, response.sessionID == sessionID,
          response.sessionGeneration == sessionGeneration
        else { throw EditorBridgeError.invalidJavaScriptResult }
      }
    } else if result.response != nil {
      throw EditorBridgeError.invalidJavaScriptResult
    }
  }

  private func requireTransport() throws -> any EditorJavaScriptTransport {
    guard let transport else { throw EditorBridgeError.transportUnavailable }
    return transport
  }

  private func startOpenTimeout(_ transfer: OutboundChunkTransfer) {
    openTimeoutTask = Task { @MainActor [weak self, weak transfer] in
      try? await Task.sleep(for: .milliseconds(self?.operationTimeoutMilliseconds ?? 0))
      guard !Task.isCancelled, let self, let transfer, self.openTransfer === transfer else {
        return
      }
      self.enterDesynchronized()
    }
  }

  private func startSnapshotTimeout(requestID: UUID, revision: UInt64) {
    snapshotTimeoutTask?.cancel()
    snapshotTimeoutTask = Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(self?.operationTimeoutMilliseconds ?? 0))
      guard !Task.isCancelled, let self, self.pendingSnapshotRequestID == requestID,
        self.pendingSnapshotRevision == revision
      else { return }
      self.enterDesynchronized()
    }
  }

  private func isPendingSnapshot(_ message: EditorMessage) -> Bool {
    message.requestID == pendingSnapshotRequestID && message.revision == pendingSnapshotRevision
  }

  private func isCurrentOpen(_ message: EditorMessage, operationToken: UUID) -> Bool {
    state == .opening && openOperationToken == operationToken && openMessage == message
      && openRequestID == message.requestID
  }

  private func failPendingSnapshot() {
    incomingSnapshot?.cancel()
    snapshotTimeoutTask?.cancel()
    snapshotTimeoutTask = nil
    incomingSnapshot = nil
    pendingSnapshotRequestID = nil
    pendingSnapshotRevision = nil
    pendingSnapshotReference = nil
  }

  private func cancelPendingOperations() {
    openTransfer?.cancel()
    incomingSnapshot?.cancel()
    openTimeoutTask?.cancel()
    snapshotTimeoutTask?.cancel()
    openTransfer = nil
    openMessage = nil
    openRequestID = nil
    openOperationToken = nil
    incomingSnapshot = nil
    pendingSnapshotRequestID = nil
    pendingSnapshotRevision = nil
    pendingSnapshotReference = nil
    openTimeoutTask = nil
    snapshotTimeoutTask = nil
  }

  private func enterDesynchronized() {
    guard state != .invalidated else { return }
    let wasFatal = state == .desynchronized
    cancelPendingOperations()
    state = .desynchronized
    if !wasFatal { onFatal?() }
  }
}
