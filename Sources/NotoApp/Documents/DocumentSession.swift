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
  case closed
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
      monitor = monitorFactory(lease.url) { [weak self] event in
        Task { @MainActor [weak self] in self?.handlePresentedItemChange(event) }
      }
      try transition(to: .ready, allowedFrom: [.loading])
      try transition(to: .editing, allowedFrom: [.ready])
    } catch {
      monitor?.invalidate()
      monitor = nil
      lease?.close()
      lease = nil
      state = .saveFailed
      throw error
    }
  }

  func recordEditorChange(text: String, revision: UInt64) throws {
    guard state == .editing || state == .conflict else {
      throw DocumentSessionError.invalidTransition(from: state, to: .editing)
    }
    guard revision > editorRevision else { return }
    self.text = text
    editorRevision = revision
    isDirty = true
  }

  func save(text candidateText: String, revision: UInt64) throws {
    guard state == .editing else {
      if state == .conflict { throw DocumentSessionError.externalChange }
      if state == .closed { throw DocumentSessionError.closed }
      throw DocumentSessionError.invalidTransition(from: state, to: .snapshotting)
    }
    guard
      revision == editorRevision,
      let envelope,
      let acceptedFingerprint,
      let destinationURL = lease?.url
    else {
      throw DocumentSessionError.invalidTransition(from: state, to: .snapshotting)
    }
    guard candidateText == text else {
      throw DocumentSessionError.snapshotContentMismatch(revision: revision)
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
    try transition(to: .snapshotting, allowedFrom: [.editing])
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
      acceptedRevision = revision
      isDirty = false
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
      return
    case .changed:
      break
    }
    if isDirty || state == .snapshotting || state == .committing {
      state = .conflict
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
      let envelope = try MarkdownEnvelope(data: snapshot.data)
      generation = UUID()
      self.envelope = envelope
      acceptedFingerprint = snapshot.fingerprint
      text = envelope.text
      editorRevision = 0
      acceptedRevision = 0
      state = .editing
      acknowledgePresentedChanges()
    } catch {
      state = .conflict
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
