import Foundation
import XCTest

@testable import Noto

@MainActor
final class DocumentSessionTests: XCTestCase {
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

  private func makeSession(
    fixture: TemporaryMarkdownFixture,
    accessor: RecordingScopeAccessor,
    isStale: Bool = false
  ) -> DocumentSession {
    DocumentSession(
      fileURL: fixture.fileURL,
      bookmark: SecurityScopedBookmark(data: Data("bookmark".utf8)),
      fileAccess: CoordinatedFileAccess(
        coordinator: PassthroughFileCoordinator(),
        writer: AtomicFileWriter()
      ),
      bookmarkResolver: FixedBookmarkResolver(url: fixture.fileURL, isStale: isStale),
      scopeAccessor: accessor
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
