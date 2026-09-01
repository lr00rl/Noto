import Foundation

enum DocumentSessionState: Equatable, Sendable {
  case created
  case loading
  case ready
  case editing
  case snapshotting
  case committing
  case conflict
  case saveFailed
  case closed
}

enum DocumentSessionError: Error, Equatable, Sendable {
  case invalidTransition(from: DocumentSessionState, to: DocumentSessionState)
  case externalChange
  case snapshotContentMismatch(revision: UInt64)
  case revisionDesynchronized(expected: UInt64, received: UInt64)
  case closed
}

struct EditorRevisionMetadata: Equatable, Sendable {
  let revision: UInt64
  let utf8ByteLength: Int
  let sha256: String
}

struct VerifiedDocumentSnapshot: Equatable, Sendable {
  let revision: UInt64
  let data: Data
  let sha256: String

  init(revision: UInt64, data: Data, sha256: String) throws {
    guard data.count <= MarkdownEnvelope.maximumByteCount,
      ChunkHash.sha256(data) == sha256
    else { throw DocumentSessionError.snapshotContentMismatch(revision: revision) }
    self.revision = revision
    self.data = data
    self.sha256 = sha256
  }
}

@MainActor
final class DocumentSession {
  typealias MonitorFactory = (
    URL,
    @escaping @Sendable (ExternalChangeEvent) -> Void
  ) -> ExternalChangeMonitor

  private(set) var state: DocumentSessionState = .created
  private(set) var generation = UUID()
  private(set) var editorRevision: UInt64 = 0
  private(set) var acceptedRevision: UInt64 = 0
  private(set) var isDirty = false
  /// The last durable document text. Live editor text, selection, and undo remain in CodeMirror.
  private(set) var text = ""

  let fileURL: URL
  let bookmark: SecurityScopedBookmark

  private let fileAccess: CoordinatedFileAccess
  private let bookmarkResolver: any BookmarkDataResolving
  private let scopeAccessor: any SecurityScopeAccessing
  private let monitorFactory: MonitorFactory
  private var lease: SecurityScopedResourceLease?
  private var monitor: ExternalChangeMonitor?
  private var envelope: MarkdownEnvelope?
  private var acceptedFingerprint: FileFingerprint?
  private var revisionMetadata: [UInt64: EditorRevisionMetadata] = [:]
  private var transactionMetadata: [UUID: EditorRevisionMetadata] = [:]
  private var authorityConflictHandler: (@MainActor () -> Void)?

  init(
    fileURL: URL,
    bookmark: SecurityScopedBookmark,
    fileAccess: CoordinatedFileAccess = CoordinatedFileAccess(),
    bookmarkResolver: any BookmarkDataResolving = SystemBookmarkDataResolver(),
    scopeAccessor: any SecurityScopeAccessing = SystemSecurityScopeAccessor(),
    monitorFactory: @escaping MonitorFactory = ExternalChangeMonitor.init
  ) {
    self.fileURL = fileURL
    self.bookmark = bookmark
    self.fileAccess = fileAccess
    self.bookmarkResolver = bookmarkResolver
    self.scopeAccessor = scopeAccessor
    self.monitorFactory = monitorFactory
  }

  func open() throws {
    try transition(to: .loading, allowedFrom: [.created])
    do {
      let lease = try bookmark.access(resolver: bookmarkResolver, accessor: scopeAccessor)
      self.lease = lease
      let snapshot = try fileAccess.read(at: lease.url)
      let envelope = try MarkdownEnvelope(data: snapshot.data)
      self.envelope = envelope
      acceptedFingerprint = snapshot.fingerprint
      text = envelope.text
      revisionMetadata[0] = EditorRevisionMetadata(
        revision: 0, utf8ByteLength: Data(envelope.text.utf8).count,
        sha256: ChunkHash.sha256(Data(envelope.text.utf8)))
      monitor = monitorFactory(lease.url) { [weak self] event in
        Task { @MainActor [weak self] in self?.handlePresentedItemChange(event) }
      }
      try transition(to: .ready, allowedFrom: [.loading])
    } catch {
      monitor?.invalidate()
      monitor = nil
      lease?.close()
      lease = nil
      state = .saveFailed
      throw error
    }
  }

  func beginEditing() throws {
    try transition(to: .editing, allowedFrom: [.ready])
  }

  func setAuthorityConflictHandler(_ handler: (@MainActor () -> Void)?) {
    authorityConflictHandler = handler
  }

  @discardableResult
  func recordEditorDelta(
    transactionID: UUID,
    fromRevision: UInt64,
    toRevision: UInt64,
    utf8ByteLength: Int,
    sha256: String
  ) throws -> Bool {
    guard state == .editing || state == .snapshotting || state == .committing else {
      throw DocumentSessionError.invalidTransition(from: state, to: .editing)
    }
    let metadata = EditorRevisionMetadata(
      revision: toRevision, utf8ByteLength: utf8ByteLength, sha256: sha256)
    if let prior = transactionMetadata[transactionID] {
      guard prior == metadata, fromRevision + 1 == toRevision else {
        throw DocumentSessionError.revisionDesynchronized(
          expected: editorRevision, received: fromRevision)
      }
      return false
    }
    guard fromRevision == editorRevision, toRevision == fromRevision + 1,
      utf8ByteLength >= 0, utf8ByteLength <= MarkdownEnvelope.maximumByteCount,
      EditorProtocolCodec.isSHA256(sha256)
    else {
      throw DocumentSessionError.revisionDesynchronized(
        expected: editorRevision, received: fromRevision)
    }
    transactionMetadata[transactionID] = metadata
    revisionMetadata[toRevision] = metadata
    editorRevision = toRevision
    isDirty = true
    return true
  }

  func save(snapshot: VerifiedDocumentSnapshot) throws {
    guard state == .editing || state == .saveFailed else {
      if state == .conflict { throw DocumentSessionError.externalChange }
      if state == .closed { throw DocumentSessionError.closed }
      throw DocumentSessionError.invalidTransition(from: state, to: .snapshotting)
    }
    guard
      snapshot.revision <= editorRevision,
      let expectedMetadata = revisionMetadata[snapshot.revision],
      let envelope,
      let acceptedFingerprint,
      let destinationURL = lease?.url
    else {
      throw DocumentSessionError.invalidTransition(from: state, to: .snapshotting)
    }
    guard expectedMetadata.utf8ByteLength == snapshot.data.count,
      expectedMetadata.sha256 == snapshot.sha256,
      let candidateText = String(data: snapshot.data, encoding: .utf8)
    else {
      throw DocumentSessionError.snapshotContentMismatch(revision: snapshot.revision)
    }

    guard let monitor else {
      throw DocumentSessionError.invalidTransition(from: state, to: .snapshotting)
    }

    let pendingPresenterChanges = monitor.snapshot()
    guard
      pendingPresenterChanges.events.allSatisfy({ event in
        if case .changed(let fingerprint) = event {
          return fingerprint == acceptedFingerprint
        }
        return false
      })
    else {
      state = .conflict
      throw DocumentSessionError.externalChange
    }
    monitor.acknowledge(through: pendingPresenterChanges.generation)

    let presenterGeneration = pendingPresenterChanges.generation
    try transition(to: .snapshotting, allowedFrom: [.editing, .saveFailed])
    do {
      let data = try envelope.encodedData(for: candidateText)
      try transition(to: .committing, allowedFrom: [.snapshotting])
      let committed = try fileAccess.replace(
        at: destinationURL,
        expectedFingerprint: acceptedFingerprint,
        data: data
      )
      let presenterChanges = monitor.snapshot(since: presenterGeneration)
      guard committed.data == data,
        presenterChanges.events.allSatisfy({ event in
          if case .changed(let fingerprint) = event {
            return fingerprint == committed.fingerprint
          }
          return false
        })
      else {
        throw DocumentSessionError.externalChange
      }

      self.envelope = try MarkdownEnvelope(data: committed.data)
      self.acceptedFingerprint = committed.fingerprint
      text = candidateText
      acceptedRevision = snapshot.revision
      isDirty = editorRevision != snapshot.revision
      monitor.acknowledge(through: presenterChanges.generation)
      try transition(to: .editing, allowedFrom: [.committing])
    } catch DocumentSessionError.externalChange {
      state = .conflict
      throw DocumentSessionError.externalChange
    } catch {
      state = .saveFailed
      throw error
    }
  }

  func close() {
    guard state != .closed else { return }
    monitor?.invalidate()
    monitor = nil
    lease?.close()
    lease = nil
    state = .closed
  }

  private func handlePresentedItemChange(_ event: ExternalChangeEvent) {
    guard state != .closed else { return }
    switch event {
    case .moved, .deleted:
      monitor?.invalidate()
      state = .conflict
      authorityConflictHandler?()
      return
    case .changed(let fingerprint):
      if fingerprint == acceptedFingerprint {
        acknowledgePresentedChanges()
        return
      }
    }
    if isDirty || state == .snapshotting || state == .committing {
      state = .conflict
      authorityConflictHandler?()
      return
    }

    do {
      guard let sourceURL = monitor?.presentedItemURL else {
        throw DocumentSessionError.externalChange
      }
      let snapshot = try fileAccess.read(at: sourceURL)
      guard snapshot.fingerprint != acceptedFingerprint else {
        acknowledgePresentedChanges()
        return
      }
      state = .conflict
      authorityConflictHandler?()
    } catch {
      state = .conflict
      authorityConflictHandler?()
    }
  }

  private func acknowledgePresentedChanges() {
    guard let monitor else { return }
    monitor.acknowledge(through: monitor.snapshot().generation)
  }

  private func transition(
    to nextState: DocumentSessionState,
    allowedFrom states: Set<DocumentSessionState>
  ) throws {
    guard states.contains(state) else {
      throw DocumentSessionError.invalidTransition(from: state, to: nextState)
    }
    state = nextState
  }
}
