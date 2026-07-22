import Foundation
import WebKit

@MainActor
protocol EditorJavaScriptTransport: AnyObject {
  func bootstrap(sessionID: UUID, generation: UInt64) async throws
  func receive(_ message: EditorMessage) async throws
}

@MainActor
final class WebKitEditorJavaScriptTransport: EditorJavaScriptTransport {
  weak var webView: WKWebView?

  init(webView: WKWebView? = nil) {
    self.webView = webView
  }

  func bootstrap(sessionID: UUID, generation: UInt64) async throws {
    guard let webView else { throw EditorBridgeError.transportUnavailable }
    _ = try await webView.callAsyncJavaScript(
      "return window.notoBridge.bootstrap(command)",
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
  }

  func receive(_ message: EditorMessage) async throws {
    guard let webView else { throw EditorBridgeError.transportUnavailable }
    _ = try await webView.callAsyncJavaScript(
      "return window.notoBridge.receive(message)",
      arguments: ["message": message.foundationObject],
      in: nil,
      contentWorld: .page
    )
  }
}

enum EditorBridgeError: Error, Equatable, Sendable {
  case transportUnavailable
  case invalidState
  case wrongSession
  case retiredGeneration
  case futureGeneration
  case unexpectedMessage
  case desynchronized
  case invalidated
}

@MainActor
final class EditorBridge {
  enum State: Equatable, Sendable {
    case created
    case bootstrapping
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
  private var openTransfer: OutboundChunkTransfer?
  private var openRequestID: UUID?
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
    sessionGeneration: UInt64 = 1
  ) {
    self.session = session
    self.transport = transport
    self.sessionID = sessionID
    self.sessionGeneration = sessionGeneration
  }

  func bootstrap() async throws {
    guard state == .created else { throw EditorBridgeError.invalidState }
    state = .bootstrapping
    do {
      try await requireTransport().bootstrap(sessionID: sessionID, generation: sessionGeneration)
      state = .awaitingReady
    } catch {
      state = .desynchronized
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
    do {
      try await send(
        .documentSnapshotRequest, requestID: requestID, revision: revision,
        payload: ["frozenRevision": .integer(revision)])
    } catch {
      failPendingSnapshot()
      throw error
    }
  }

  func receive(_ body: Any) async throws {
    guard state != .invalidated else { throw EditorBridgeError.invalidated }
    let message = try EditorProtocolCodec.decode(body)
    guard message.sessionID == sessionID else { throw EditorBridgeError.wrongSession }
    if message.sessionGeneration < sessionGeneration { return }
    guard message.sessionGeneration == sessionGeneration else {
      state = .desynchronized
      throw EditorBridgeError.futureGeneration
    }

    switch message.type {
    case .editorReady:
      try await receiveReady(message)
    case .editorDelta:
      try await receiveDelta(message)
    case .documentSnapshotResponse:
      do { try receiveSnapshotReference(message) } catch {
        await failSnapshotTransfer(message)
        throw error
      }
    case .chunkBegin:
      do { try receiveChunkBegin(message) } catch {
        await failSnapshotTransfer(message)
        throw error
      }
    case .chunkData:
      do { try await receiveChunkData(message) } catch {
        await failSnapshotTransfer(message)
        throw error
      }
    case .chunkAck:
      try await receiveChunkAcknowledgement(message)
    case .chunkEnd:
      do { try await receiveChunkEnd(message) } catch {
        await failSnapshotTransfer(message)
        throw error
      }
    case .error:
      if message.requestID == openRequestID {
        state = .desynchronized
      } else if message.requestID == pendingSnapshotRequestID,
        message.revision == pendingSnapshotRevision
      {
        failPendingSnapshot()
      } else {
        throw EditorBridgeError.unexpectedMessage
      }
    default:
      throw EditorBridgeError.unexpectedMessage
    }
  }

  func invalidate() {
    guard state != .invalidated else { return }
    openTransfer?.cancel()
    incomingSnapshot?.cancel()
    openTimeoutTask?.cancel()
    snapshotTimeoutTask?.cancel()
    openTransfer = nil
    openRequestID = nil
    incomingSnapshot = nil
    pendingSnapshotRequestID = nil
    pendingSnapshotRevision = nil
    pendingSnapshotReference = nil
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
    openTransfer = transfer
    openRequestID = identity.requestID
    let timeout = transfer.descriptor.timeoutMilliseconds
    openTimeoutTask = Task { @MainActor [weak self, weak transfer] in
      try? await Task.sleep(for: .milliseconds(timeout))
      guard !Task.isCancelled, let self, let transfer, self.openTransfer === transfer else {
        return
      }
      transfer.timeout()
      self.openTransfer = nil
      self.state = .desynchronized
      try? await self.send(
        .error, requestID: transfer.descriptor.identity.requestID,
        revision: transfer.descriptor.identity.revision,
        payload: [
          "code": .string("transferTimeout"),
          "message": .string("Open transfer timed out"),
          "retryable": .bool(false),
        ])
    }
    try await send(
      .documentOpen, requestID: identity.requestID, revision: 0,
      payload: [
        "transferId": .string(identity.transferID.uuidString.lowercased()),
        "utf8ByteLength": .integer(UInt64(body.count)),
        "sha256": .string(transfer.descriptor.sha256),
      ])
    try await sendBegin(transfer.descriptor)
    try await sendNextOpenChunk()
  }

  private func receiveDelta(_ message: EditorMessage) async throws {
    guard state == .editing || pendingSnapshotRequestID != nil,
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
      state = .desynchronized
      try? await send(
        .error, requestID: message.requestID, revision: message.revision,
        payload: [
          "code": .string("checkpointRequired"),
          "message": .string("Revision metadata is desynchronized"),
          "retryable": .bool(false),
        ])
      throw EditorBridgeError.desynchronized
    }
  }

  private func receiveSnapshotReference(_ message: EditorMessage) throws {
    guard message.requestID == pendingSnapshotRequestID,
      message.revision == pendingSnapshotRevision,
      case .string(let transfer) = message.payload["transferId"],
      let transferID = UUID(uuidString: transfer),
      case .integer(let byteCount) = message.payload["utf8ByteLength"],
      case .string(let sha256) = message.payload["sha256"]
    else { throw EditorBridgeError.unexpectedMessage }
    guard pendingSnapshotReference == nil else { throw EditorBridgeError.unexpectedMessage }
    pendingSnapshotReference = (transferID, Int(byteCount), sha256)
  }

  private func receiveChunkBegin(_ message: EditorMessage) throws {
    guard incomingSnapshot == nil, let reference = pendingSnapshotReference,
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
      case .integer(let timeout) = message.payload["timeoutMs"]
    else { throw EditorBridgeError.unexpectedMessage }
    guard transferID == reference.transferID, Int(totalBytes) == reference.byteCount,
      sha256 == reference.sha256
    else { throw EditorBridgeError.unexpectedMessage }
    let descriptor = try ChunkTransferDescriptor(
      identity: ChunkTransferIdentity(
        requestID: message.requestID, sessionID: sessionID,
        sessionGeneration: sessionGeneration, revision: message.revision, transferID: transferID),
      purpose: purpose, totalBytes: Int(totalBytes), chunkBytes: Int(chunkBytes),
      totalChunks: Int(totalChunks), sha256: sha256, timeoutMilliseconds: Int(timeout))
    incomingSnapshot = InboundChunkTransfer(descriptor: descriptor)
    snapshotTimeoutTask = Task { @MainActor [weak self, weak incoming = incomingSnapshot] in
      try? await Task.sleep(for: .milliseconds(Int(timeout)))
      guard !Task.isCancelled, let self, let incoming, self.incomingSnapshot === incoming else {
        return
      }
      incoming.timeout()
      let requestID = self.pendingSnapshotRequestID
      let revision = self.pendingSnapshotRevision
      self.failPendingSnapshot()
      if let requestID, let revision {
        try? await self.send(
          .documentSaveFailed, requestID: requestID, revision: revision,
          payload: [
            "code": .string("transferTimeout"),
            "message": .string("Snapshot transfer timed out"),
            "retryable": .bool(true),
          ])
      }
    }
  }

  private func receiveChunkData(_ message: EditorMessage) async throws {
    guard let transfer = incomingSnapshot,
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
    try await send(
      .chunkAck, requestID: message.requestID, revision: message.revision,
      payload: [
        "transferId": .string(transferID.uuidString.lowercased()),
        "ackedThrough": .integer(UInt64(acknowledged)),
      ])
    try transfer.didSendAcknowledgement(through: acknowledged)
  }

  private func receiveChunkAcknowledgement(_ message: EditorMessage) async throws {
    guard let transfer = openTransfer,
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
    guard let transfer = openTransfer else { throw EditorBridgeError.invalidState }
    if let frame = try transfer.nextFrame() {
      try await send(
        .chunkData, requestID: frame.identity.requestID, revision: frame.identity.revision,
        payload: [
          "transferId": .string(frame.identity.transferID.uuidString.lowercased()),
          "index": .integer(UInt64(frame.index)),
          "byteLength": .integer(UInt64(frame.byteLength)),
          "dataBase64": .string(frame.dataBase64),
        ])
      return
    }
    let end = try transfer.endFrame()
    try await sendEnd(end)
    openTransfer = nil
    openTimeoutTask?.cancel()
    openTimeoutTask = nil
    try session.beginEditing()
    state = .editing
  }

  private func receiveChunkEnd(_ message: EditorMessage) async throws {
    guard let transfer = incomingSnapshot,
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
    snapshotTimeoutTask?.cancel()
    snapshotTimeoutTask = nil
    let snapshot: VerifiedDocumentSnapshot
    do {
      snapshot = try VerifiedDocumentSnapshot(
        revision: message.revision, data: body, sha256: sha256)
      try session.save(snapshot: snapshot)
    } catch {
      failPendingSnapshot()
      try await send(
        .documentSaveFailed, requestID: message.requestID, revision: message.revision,
        payload: [
          "code": .string("replaceFailed"), "message": .string("Atomic replacement failed"),
          "retryable": .bool(true),
        ])
      return
    }
    failPendingSnapshot()
    try await send(
      .documentSaved, requestID: message.requestID, revision: message.revision,
      payload: [
        "durableRevision": .integer(message.revision), "sha256": .string(sha256),
      ])
  }

  private func sendBegin(_ descriptor: ChunkTransferDescriptor) async throws {
    try await send(
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
  }

  private func sendEnd(_ frame: ChunkEndFrame) async throws {
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
  ) async throws {
    let message = try EditorMessage(
      type: type, requestID: requestID, sessionID: sessionID,
      sessionGeneration: sessionGeneration, revision: revision, payload: payload)
    try await requireTransport().receive(message)
  }

  private func requireTransport() throws -> any EditorJavaScriptTransport {
    guard let transport else { throw EditorBridgeError.transportUnavailable }
    return transport
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

  private func failSnapshotTransfer(_ message: EditorMessage) async {
    guard message.requestID == pendingSnapshotRequestID,
      message.revision == pendingSnapshotRevision
    else { return }
    let requestID = message.requestID
    let revision = message.revision
    failPendingSnapshot()
    try? await send(
      .documentSaveFailed, requestID: requestID, revision: revision,
      payload: [
        "code": .string("transferRejected"),
        "message": .string("Snapshot transfer rejected"),
        "retryable": .bool(true),
      ])
  }
}
