import Darwin
import Foundation
import XCTest

@testable import Noto

@MainActor
final class AtomicFileWriterTests: XCTestCase {
  func testRealWriterReplacesBytesPreservesPermissionsAndLeavesNoTemporaryFile() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let file = directory.appendingPathComponent("document.md")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    try Data("old".utf8).write(to: file)
    try FileManager.default.setAttributes([.posixPermissions: 0o640], ofItemAtPath: file.path)

    try AtomicFileWriter().write(
      Data("new bytes".utf8),
      to: file,
      validatingDestination: {}
    )

    XCTAssertEqual(try Data(contentsOf: file), Data("new bytes".utf8))
    let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
    XCTAssertEqual(attributes[.posixPermissions] as? Int, 0o640)
    XCTAssertEqual(
      try FileManager.default.contentsOfDirectory(atPath: directory.path),
      ["document.md"]
    )
  }

  func testInjectedFailuresBeforeReplacementDoNotReachReplace() throws {
    for stage in FakeAtomicFileSystem.Stage.allCases
    where stage != .directoryFlush && stage != .cleanup {
      let fileSystem = FakeAtomicFileSystem(failingAt: stage)
      XCTAssertThrowsError(
        try AtomicFileWriter(fileSystem: fileSystem).write(
          Data("new".utf8),
          to: URL(fileURLWithPath: "/tmp/document.md"),
          validatingDestination: { try fileSystem.validateDestination() }
        ),
        "Expected failure at \(stage)"
      )
      if stage != .replace {
        XCTAssertFalse(
          fileSystem.events.contains(.replace), "Replacement reached after \(stage) failure")
      }
      XCTAssertTrue(fileSystem.events.contains(.cleanup) || stage == .create)
    }
  }

  func testSuccessfulInjectedSequenceValidatesImmediatelyBeforeReplacement() throws {
    let fileSystem = FakeAtomicFileSystem()
    try AtomicFileWriter(fileSystem: fileSystem).write(
      Data("new".utf8),
      to: URL(fileURLWithPath: "/tmp/document.md"),
      validatingDestination: { try fileSystem.validateDestination() }
    )
    XCTAssertEqual(
      fileSystem.events,
      [
        .create, .write, .flush, .metadata, .flush, .close, .validation, .replace,
        .directoryFlush,
      ]
    )
  }

  func testValidationFailureCleansTemporaryFileWithoutReplacingDestination() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let file = directory.appendingPathComponent("document.md")
    let originalData = Data("old".utf8)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    try originalData.write(to: file)

    XCTAssertThrowsError(
      try AtomicFileWriter().write(
        Data("new".utf8),
        to: file,
        validatingDestination: { throw ValidationError.changed }
      )
    ) { error in
      XCTAssertEqual(error as? ValidationError, .changed)
    }
    XCTAssertEqual(try Data(contentsOf: file), originalData)
    XCTAssertEqual(
      try FileManager.default.contentsOfDirectory(atPath: directory.path),
      ["document.md"]
    )

    let fileSystem = FakeAtomicFileSystem(failingAt: .validation)
    XCTAssertThrowsError(
      try AtomicFileWriter(fileSystem: fileSystem).write(
        Data("new".utf8),
        to: file,
        validatingDestination: { try fileSystem.validateDestination() }
      )
    ) { error in
      XCTAssertEqual(error as? FakeAtomicFileSystem.Stage, .validation)
    }
    XCTAssertEqual(
      fileSystem.events,
      [.create, .write, .flush, .metadata, .flush, .close, .validation, .cleanup]
    )
    XCTAssertFalse(fileSystem.events.contains(.replace))
    XCTAssertFalse(fileSystem.events.contains(.directoryFlush))
  }
}

private enum ValidationError: Error {
  case changed
}

private final class FakeAtomicFileSystem: AtomicFileSystem, @unchecked Sendable {
  enum Stage: String, CaseIterable, Error {
    case create
    case write
    case flush
    case metadata
    case close
    case validation
    case replace
    case directoryFlush
    case cleanup
  }

  private(set) var events: [Stage] = []
  private let failingStage: Stage?

  init(failingAt failingStage: Stage? = nil) {
    self.failingStage = failingStage
  }

  func createTemporaryFile(at url: URL) throws -> Int32 {
    try record(.create)
    return 42
  }

  func write(_ data: Data, to descriptor: Int32) throws { try record(.write) }
  func flushFile(_ descriptor: Int32) throws { try record(.flush) }
  func copyMetadata(from destinationURL: URL, to descriptor: Int32) throws { try record(.metadata) }
  func closeFile(_ descriptor: Int32) throws { try record(.close) }
  func validateDestination() throws { try record(.validation) }
  func replaceItem(at destinationURL: URL, with temporaryURL: URL) throws { try record(.replace) }
  func flushDirectory(at directoryURL: URL) throws { try record(.directoryFlush) }

  func removeItemIfPresent(at url: URL) {
    events.append(.cleanup)
  }

  private func record(_ stage: Stage) throws {
    events.append(stage)
    if failingStage == stage { throw stage }
  }
}
