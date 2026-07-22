import Foundation
import XCTest

@testable import Noto

@MainActor
final class DocumentSessionTests: XCTestCase {
  func testBookmarkDataSurvivesStoreReconstruction() throws {
    let fixture = try TemporaryMarkdownFixture(data: Data("hello".utf8))
    let persistence = MemoryBookmarkPersistence()
    let resolver = FixedBookmarkResolver(url: fixture.fileURL, isStale: false)

    let firstStore = SecurityScopedBookmarkStore(
      persistence: persistence,
      resolver: resolver
    )
    let saved = try firstStore.save(url: fixture.fileURL, identifier: "document")

    let restored = try SecurityScopedBookmarkStore(
      persistence: persistence,
      resolver: resolver
    ).bookmark(identifier: "document")
    XCTAssertEqual(restored, saved)
  }

  func testOpenAndCloseBalanceSecurityScopedAccess() throws {
    let fixture = try TemporaryMarkdownFixture(data: Data("hello\n".utf8))
    let accessor = RecordingScopeAccessor(allowsAccess: true)
    let session = makeSession(fixture: fixture, accessor: accessor)

    try session.open()

    XCTAssertEqual(session.state, .editing)
    XCTAssertEqual(session.text, "hello\n")
    XCTAssertEqual(accessor.startCount, 1)
    XCTAssertEqual(accessor.stopCount, 0)

    session.close()
    XCTAssertEqual(session.state, .closed)
    XCTAssertEqual(accessor.stopCount, 1)

    session.close()
    XCTAssertEqual(accessor.stopCount, 1)
  }

  func testStaleBookmarkRejectsBeforeAccessOrRead() throws {
    let fixture = try TemporaryMarkdownFixture(data: Data("hello".utf8))
    let accessor = RecordingScopeAccessor(allowsAccess: true)
    let session = makeSession(fixture: fixture, accessor: accessor, isStale: true)

    XCTAssertThrowsError(try session.open()) { error in
      XCTAssertEqual(error as? SecurityScopedBookmarkError, .staleBookmark)
    }
    XCTAssertEqual(session.state, .saveFailed)
    XCTAssertEqual(accessor.startCount, 0)
    XCTAssertEqual(accessor.stopCount, 0)
  }

  func testInvalidMarkdownBalancesAccessAndCreatesNoEditableSession() throws {
    let fixture = try TemporaryMarkdownFixture(data: Data([0xFF]))
    let accessor = RecordingScopeAccessor(allowsAccess: true)
    let session = makeSession(fixture: fixture, accessor: accessor)

    XCTAssertThrowsError(try session.open()) { error in
      XCTAssertEqual(error as? MarkdownEnvelopeError, .invalidUTF8)
    }
    XCTAssertEqual(session.state, .saveFailed)
    XCTAssertEqual(accessor.startCount, 1)
    XCTAssertEqual(accessor.stopCount, 1)
  }

  func testExternalModificationAbortsSaveWithoutOverwritingDisk() throws {
    let fixture = try TemporaryMarkdownFixture(data: Data("initial\n".utf8))
    let accessor = RecordingScopeAccessor(allowsAccess: true)
    let session = makeSession(fixture: fixture, accessor: accessor)
    try session.open()
    try session.recordEditorChange(text: "editor\n", revision: 1)

    let externalData = Data("external\n".utf8)
    try externalData.write(to: fixture.fileURL)

    XCTAssertThrowsError(try session.save(text: "editor\n", revision: 1)) { error in
      XCTAssertEqual(error as? DocumentSessionError, .externalChange)
    }
    XCTAssertEqual(session.state, .conflict)
    XCTAssertTrue(session.isDirty)
    XCTAssertEqual(try Data(contentsOf: fixture.fileURL), externalData)
  }

  func testSuccessfulSaveAcceptsOnlyTheRequestedRevision() throws {
    let fixture = try TemporaryMarkdownFixture(data: Data("initial\n".utf8))
    let accessor = RecordingScopeAccessor(allowsAccess: true)
    let session = makeSession(fixture: fixture, accessor: accessor)
    try session.open()
    try session.recordEditorChange(text: "saved\n", revision: 4)

    XCTAssertThrowsError(try session.save(text: "stale\n", revision: 3))
    XCTAssertTrue(session.isDirty)

    try session.save(text: "saved\n", revision: 4)
    XCTAssertEqual(session.state, .editing)
    XCTAssertFalse(session.isDirty)
    XCTAssertEqual(session.acceptedRevision, 4)
    XCTAssertEqual(try Data(contentsOf: fixture.fileURL), Data("saved\n".utf8))
  }

  func testPresenterEventBetweenFingerprintCheckAndCommitForcesConflict() throws {
    let fixture = try TemporaryMarkdownFixture(data: Data("initial\n".utf8))
    let accessor = RecordingScopeAccessor(allowsAccess: true)
    let monitor = LockedValue<ExternalChangeMonitor?>(nil)
    let externalData = Data("external\n".utf8)
    let writer = InterleavingFileWriter(beforeWrite: { url in
      try externalData.write(to: url)
      monitor.value?.presentedItemDidChange()
    })
    let session = makeSession(
      fixture: fixture,
      accessor: accessor,
      writer: writer,
      monitor: monitor
    )
    try session.open()
    try session.recordEditorChange(text: "editor\n", revision: 1)

    XCTAssertThrowsError(try session.save(text: "editor\n", revision: 1)) { error in
      XCTAssertEqual(error as? DocumentSessionError, .externalChange)
    }
    XCTAssertEqual(session.state, .conflict)
    XCTAssertTrue(session.isDirty)
    XCTAssertEqual(session.acceptedRevision, 0)
  }

  func testSaveSuppressesOnlyPresenterEventMatchingCommittedFingerprint() throws {
    let fixture = try TemporaryMarkdownFixture(data: Data("initial\n".utf8))
    let accessor = RecordingScopeAccessor(allowsAccess: true)
    let monitor = LockedValue<ExternalChangeMonitor?>(nil)
    let writer = InterleavingFileWriter(afterWrite: { _ in
      monitor.value?.presentedItemDidChange()
    })
    let session = makeSession(
      fixture: fixture,
      accessor: accessor,
      writer: writer,
      monitor: monitor
    )
    try session.open()
    try session.recordEditorChange(text: "saved\n", revision: 1)

    try session.save(text: "saved\n", revision: 1)

    XCTAssertEqual(session.state, .editing)
    XCTAssertFalse(session.isDirty)
    XCTAssertEqual(session.acceptedRevision, 1)
  }

  func testPresenterMoveRetainsNewURLAndEntersAuthorityConflict() async throws {
    let fixture = try TemporaryMarkdownFixture(data: Data("initial\n".utf8))
    let accessor = RecordingScopeAccessor(allowsAccess: true)
    let monitor = LockedValue<ExternalChangeMonitor?>(nil)
    let session = makeSession(fixture: fixture, accessor: accessor, monitor: monitor)
    try session.open()
    let movedURL = fixture.directoryURL.appendingPathComponent("moved.md")

    monitor.value?.presentedItemDidMove(to: movedURL)
    await Task.yield()

    XCTAssertEqual(monitor.value?.presentedItemURL, movedURL)
    XCTAssertEqual(session.state, .conflict)
  }

  func testSaveRejectsContentNotRecordedForTheCurrentRevision() throws {
    let fixture = try TemporaryMarkdownFixture(data: Data("initial\n".utf8))
    let accessor = RecordingScopeAccessor(allowsAccess: true)
    let session = makeSession(fixture: fixture, accessor: accessor)
    try session.open()
    try session.recordEditorChange(text: "recorded\n", revision: 1)

    XCTAssertThrowsError(try session.save(text: "different\n", revision: 1)) { error in
      XCTAssertEqual(
        error as? DocumentSessionError,
        .snapshotContentMismatch(revision: 1)
      )
    }
    XCTAssertTrue(session.isDirty)
    XCTAssertEqual(try Data(contentsOf: fixture.fileURL), Data("initial\n".utf8))
  }

  func testExternalChangeMonitorInvalidationIsBalancedAndIdempotent() throws {
    let fixture = try TemporaryMarkdownFixture(data: Data("initial\n".utf8))
    let monitor = ExternalChangeMonitor(url: fixture.fileURL) { _ in }
    XCTAssertTrue(monitor.isRegistered)

    monitor.invalidate()
    XCTAssertFalse(monitor.isRegistered)
    monitor.invalidate()
    XCTAssertFalse(monitor.isRegistered)
  }

  func testExternalChangeMonitorUpdatesPresentedURLBeforeMoveNotification() throws {
    let fixture = try TemporaryMarkdownFixture(data: Data("initial\n".utf8))
    let movedURL = fixture.directoryURL.appendingPathComponent("moved.md")
    let receivedURL = LockedValue<URL?>(nil)
    let monitor = ExternalChangeMonitor(url: fixture.fileURL) { event in
      if case .moved(let url) = event {
        receivedURL.set(url)
      }
    }
    defer { monitor.invalidate() }

    monitor.presentedItemDidMove(to: movedURL)

    XCTAssertEqual(monitor.presentedItemURL, movedURL)
    XCTAssertEqual(receivedURL.value, movedURL)
  }

  private func makeSession(
    fixture: TemporaryMarkdownFixture,
    accessor: RecordingScopeAccessor,
    isStale: Bool = false,
    writer: any FileWriting = AtomicFileWriter(),
    monitor: LockedValue<ExternalChangeMonitor?>? = nil
  ) -> DocumentSession {
    DocumentSession(
      fileURL: fixture.fileURL,
      bookmark: SecurityScopedBookmark(data: Data("bookmark".utf8)),
      fileAccess: CoordinatedFileAccess(
        coordinator: PassthroughFileCoordinator(),
        writer: writer
      ),
      bookmarkResolver: FixedBookmarkResolver(url: fixture.fileURL, isStale: isStale),
      scopeAccessor: accessor,
      monitorFactory: { url, handler in
        let created = ExternalChangeMonitor(url: url, changeHandler: handler)
        monitor?.set(created)
        return created
      }
    )
  }
}

private struct FixedBookmarkResolver: BookmarkDataResolving {
  let url: URL
  let isStale: Bool

  func createBookmark(for url: URL) throws -> Data {
    Data("bookmark".utf8)
  }

  func resolveBookmark(_ data: Data) throws -> (url: URL, isStale: Bool) {
    (url, isStale)
  }
}

private final class MemoryBookmarkPersistence: BookmarkPersisting, @unchecked Sendable {
  private let lock = NSLock()
  private var values: [String: Data] = [:]

  func data(for identifier: String) -> Data? {
    lock.withLock { values[identifier] }
  }

  func setData(_ data: Data, for identifier: String) {
    lock.withLock { values[identifier] = data }
  }

  func removeData(for identifier: String) {
    _ = lock.withLock { values.removeValue(forKey: identifier) }
  }
}

private final class LockedValue<Value>: @unchecked Sendable {
  private let lock = NSLock()
  private var storedValue: Value

  init(_ value: Value) {
    storedValue = value
  }

  var value: Value {
    lock.withLock { storedValue }
  }

  func set(_ value: Value) {
    lock.withLock { storedValue = value }
  }
}

private final class RecordingScopeAccessor: SecurityScopeAccessing, @unchecked Sendable {
  private let lock = NSLock()
  private let allowsAccess: Bool
  private var starts = 0
  private var stops = 0

  init(allowsAccess: Bool) {
    self.allowsAccess = allowsAccess
  }

  var startCount: Int {
    lock.withLock { starts }
  }

  var stopCount: Int {
    lock.withLock { stops }
  }

  func startAccessing(_ url: URL) -> Bool {
    lock.withLock { starts += 1 }
    return allowsAccess
  }

  func stopAccessing(_ url: URL) {
    lock.withLock { stops += 1 }
  }
}

private struct PassthroughFileCoordinator: FileCoordinating {
  func coordinateReading<T>(at url: URL, _ accessor: (URL) throws -> T) throws -> T {
    try accessor(url)
  }

  func coordinateWriting<T>(at url: URL, _ accessor: (URL) throws -> T) throws -> T {
    try accessor(url)
  }
}

private struct InterleavingFileWriter: FileWriting, Sendable {
  private let beforeWrite: @Sendable (URL) throws -> Void
  private let afterWrite: @Sendable (URL) throws -> Void
  private let writer = AtomicFileWriter()

  init(
    beforeWrite: @escaping @Sendable (URL) throws -> Void = { _ in },
    afterWrite: @escaping @Sendable (URL) throws -> Void = { _ in }
  ) {
    self.beforeWrite = beforeWrite
    self.afterWrite = afterWrite
  }

  func write(_ data: Data, to destinationURL: URL) throws {
    try beforeWrite(destinationURL)
    try writer.write(data, to: destinationURL)
    try afterWrite(destinationURL)
  }
}

private final class TemporaryMarkdownFixture {
  let directoryURL: URL
  let fileURL: URL

  init(data: Data) throws {
    directoryURL = FileManager.default.temporaryDirectory.appendingPathComponent(
      "NotoDocumentSessionTests-\(UUID().uuidString)",
      isDirectory: true
    )
    fileURL = directoryURL.appendingPathComponent("fixture.md")
    try FileManager.default.createDirectory(
      at: directoryURL,
      withIntermediateDirectories: true
    )
    try data.write(to: fileURL)
  }

  deinit {
    try? FileManager.default.removeItem(at: directoryURL)
  }
}
