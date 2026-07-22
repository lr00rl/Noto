import Foundation
import XCTest

@testable import Noto

@MainActor
final class MarkdownEnvelopeTests: XCTestCase {
  func testNoOpAndEditUndoPreserveOriginalBytes() throws {
    let original = Data([0xEF, 0xBB, 0xBF]) + Data("one\r\ntwo\nthree\r".utf8)
    let envelope = try MarkdownEnvelope(data: original)

    XCTAssertEqual(envelope.text, "one\ntwo\nthree\n")
    XCTAssertTrue(envelope.hadByteOrderMark)
    XCTAssertEqual(envelope.lineEnding, .mixed)
    XCTAssertTrue(envelope.hadFinalNewline)
    XCTAssertEqual(try envelope.encodedData(for: envelope.text), original)
    XCTAssertEqual(
      try envelope.encodedData(for: "changed\n"),
      Data([0xEF, 0xBB, 0xBF]) + Data("changed\r\n".utf8))
    XCTAssertEqual(try envelope.encodedData(for: envelope.text), original)
  }

  func testDominantLineEndingWinsAndTieUsesFirstEncountered() throws {
    let dominantCRLF = try MarkdownEnvelope(data: Data("a\r\nb\r\nc\n".utf8))
    XCTAssertEqual(try dominantCRLF.encodedData(for: "x\ny\n"), Data("x\r\ny\r\n".utf8))

    let tiedFirstLF = try MarkdownEnvelope(data: Data("a\nb\r\n".utf8))
    XCTAssertEqual(try tiedFirstLF.encodedData(for: "x\ny\n"), Data("x\ny\n".utf8))

    let noLineEnding = try MarkdownEnvelope(data: Data("one".utf8))
    XCTAssertEqual(noLineEnding.lineEnding, .none)
    XCTAssertEqual(try noLineEnding.encodedData(for: "one\ntwo"), Data("one\ntwo".utf8))
  }

  func testFinalNewlineCanBeAddedAndRemoved() throws {
    let withFinalNewline = try MarkdownEnvelope(data: Data("one\r\n".utf8))
    XCTAssertEqual(try withFinalNewline.encodedData(for: "one"), Data("one".utf8))

    let withoutFinalNewline = try MarkdownEnvelope(data: Data("one".utf8))
    XCTAssertEqual(try withoutFinalNewline.encodedData(for: "one\n"), Data("one\n".utf8))
  }

  func testRejectsInvalidUTF8NULAndInteriorOrRepeatedBOM() throws {
    XCTAssertThrowsError(try MarkdownEnvelope(data: Data([0xC3, 0x28]))) {
      XCTAssertEqual($0 as? MarkdownEnvelopeError, .invalidUTF8)
    }
    XCTAssertThrowsError(try MarkdownEnvelope(data: Data([0x61, 0x00, 0x62]))) {
      XCTAssertEqual($0 as? MarkdownEnvelopeError, .containsNUL)
    }
    XCTAssertThrowsError(try MarkdownEnvelope(data: Data("a\u{FEFF}b".utf8))) {
      XCTAssertEqual($0 as? MarkdownEnvelopeError, .containsInteriorByteOrderMark)
    }
    XCTAssertThrowsError(
      try MarkdownEnvelope(data: Data([0xEF, 0xBB, 0xBF, 0xEF, 0xBB, 0xBF]))
    ) {
      XCTAssertEqual($0 as? MarkdownEnvelopeError, .containsInteriorByteOrderMark)
    }
  }

  func testEnforcesExactMaximumEncodedByteCount() throws {
    let accepted = Data(repeating: 0x61, count: MarkdownEnvelope.maximumByteCount)
    XCTAssertNoThrow(try MarkdownEnvelope(data: accepted))

    let rejected = Data(repeating: 0x61, count: MarkdownEnvelope.maximumByteCount + 1)
    XCTAssertThrowsError(try MarkdownEnvelope(data: rejected)) {
      XCTAssertEqual(
        $0 as? MarkdownEnvelopeError,
        .bodyTooLarge(
          actualBytes: MarkdownEnvelope.maximumByteCount + 1,
          maximumBytes: MarkdownEnvelope.maximumByteCount
        )
      )
    }
  }
}
