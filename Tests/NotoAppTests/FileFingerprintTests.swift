import Foundation
import XCTest

@testable import Noto

@MainActor
final class FileFingerprintTests: XCTestCase {
  func testFingerprintDetectsSameLengthReplacementWithRestoredModificationDate() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let file = directory.appendingPathComponent("document.md")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    try Data("first".utf8).write(to: file)
    let originalDate = try XCTUnwrap(
      try FileManager.default.attributesOfItem(atPath: file.path)[.modificationDate] as? Date
    )
    let first = try FileFingerprint.capture(at: file)
    XCTAssertEqual(first, try FileFingerprint.capture(at: file))

    try Data("other".utf8).write(to: file)
    try FileManager.default.setAttributes([.modificationDate: originalDate], ofItemAtPath: file.path)
    let second = try FileFingerprint.capture(at: file)

    XCTAssertEqual(first.byteCount, second.byteCount)
    XCTAssertNotEqual(first.contentSHA256, second.contentSHA256)
    XCTAssertNotEqual(first, second)
  }

  func testMissingFileThrows() {
    let missing = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    XCTAssertThrowsError(try FileFingerprint.capture(at: missing))
  }
}
