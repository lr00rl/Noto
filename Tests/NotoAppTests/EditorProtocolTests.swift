import Foundation
import XCTest

@testable import Noto

final class EditorProtocolTests: XCTestCase {
  func testAllSharedValidMessagesDecodeAndRoundTrip() throws {
    let messages = try loadFixture("valid-messages") as! [[String: Any]]
    for (index, object) in messages.enumerated() {
      do {
        let decoded = try EditorProtocolCodec.decode(object)
        let encoded = try EditorProtocolCodec.encode(decoded)
        XCTAssertEqual(try EditorProtocolCodec.decode(encoded), decoded)
      } catch {
        XCTFail("valid message \(index) (\(object["type"] ?? "unknown")) rejected: \(error)")
      }
    }
  }

  func testAllSharedInvalidMessagesAreRejected() throws {
    let fixtures = try loadFixture("invalid-messages") as! [[String: Any]]
    for fixture in fixtures {
      let message = try XCTUnwrap(fixture["message"])
      XCTAssertThrowsError(
        try EditorProtocolCodec.decode(message), fixture["name"] as? String ?? "")
    }
  }

  func testDeltaIsMetadataOnlyAndMustBeContiguous() throws {
    let base = fixtureEnvelope(
      type: "editor.delta", revision: 2,
      payload: [
        "transactionId": "40000000-0000-4000-8000-000000000001",
        "fromRevision": 1, "toRevision": 2, "utf8ByteLength": 1,
        "sha256": String(repeating: "a", count: 64),
      ])
    XCTAssertNoThrow(try EditorProtocolCodec.decode(base))
    var inline = base
    var payload = inline["payload"] as! [String: Any]
    payload["text"] = "secret"
    inline["payload"] = payload
    XCTAssertThrowsError(try EditorProtocolCodec.decode(inline))
  }

  func testUnsafeIntegerAndUnknownEnvelopeKeyAreRejected() throws {
    var object = fixtureEnvelope(type: "theme.set", revision: 0, payload: ["appearance": "dark"])
    object["sessionGeneration"] = 9_007_199_254_740_992
    XCTAssertThrowsError(try EditorProtocolCodec.decode(object))
    object["sessionGeneration"] = 1
    object["unknown"] = true
    XCTAssertThrowsError(try EditorProtocolCodec.decode(object))
  }

  private func fixtureEnvelope(type: String, revision: Int, payload: [String: Any]) -> [String: Any]
  {
    [
      "protocolVersion": 1, "type": type,
      "requestId": "10000000-0000-4000-8000-000000000001",
      "sessionId": "20000000-0000-4000-8000-000000000001",
      "sessionGeneration": 1, "revision": revision, "payload": payload,
    ]
  }

  private func loadFixture(_ name: String) throws -> Any {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let data = try Data(
      contentsOf: root.appendingPathComponent("Tests/Fixtures/BridgeProtocol/v1/\(name).json"))
    return try JSONSerialization.jsonObject(with: data)
  }
}
