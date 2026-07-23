import Foundation
import XCTest

@testable import Noto

final class ChunkTransferTests: XCTestCase {
  private let requestID = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!
  private let sessionID = UUID(uuidString: "20000000-0000-4000-8000-000000000001")!
  private let transferID = UUID(uuidString: "30000000-0000-4000-8000-000000000001")!

  func testOutboundEnforcesOneChunkWindow() throws {
    let body = Data(repeating: 0x61, count: EditorProtocolV1.defaultChunkBytes + 1)
    let transfer = try OutboundChunkTransfer(
      identity: identity, purpose: "document.open", body: body)
    let first = try XCTUnwrap(transfer.nextFrame())
    XCTAssertEqual(first.index, 0)
    XCTAssertThrowsError(try transfer.nextFrame()) { error in
      XCTAssertEqual(error as? ChunkTransferError, .backpressureViolation)
    }
    try transfer.acknowledge(identity: identity, through: 0)
    XCTAssertEqual(try transfer.nextFrame()?.index, 1)
  }

  func testInboundPublishesOnlyAfterExactLengthOrderAndHashValidation() throws {
    let body = Data("hello world".utf8)
    let descriptor = try ChunkTransferDescriptor(
      identity: identity, purpose: "document.snapshot.response", totalBytes: body.count,
      sha256: ChunkHash.sha256(body))
    let transfer = InboundChunkTransfer(descriptor: descriptor)
    let index = try transfer.receive(
      ChunkDataFrame(
        identity: identity, index: 0, byteLength: body.count,
        dataBase64: body.base64EncodedString()))
    try transfer.didSendAcknowledgement(through: index)
    let published = try transfer.finish(
      ChunkEndFrame(
        identity: identity, totalBytes: body.count, totalChunks: 1,
        sha256: ChunkHash.sha256(body)))
    XCTAssertEqual(published, body)
  }

  func testZeroByteTransferUsesOneCanonicalEmptyChunk() throws {
    let transfer = try OutboundChunkTransfer(
      identity: identity, purpose: "document.open", body: Data())
    let frame = try XCTUnwrap(transfer.nextFrame())
    XCTAssertEqual(frame.byteLength, 0)
    XCTAssertEqual(frame.dataBase64, "")
    try transfer.acknowledge(identity: identity, through: 0)
    XCTAssertEqual(try transfer.endFrame().totalChunks, 1)
  }

  func testMalformedBase64AndTimeoutDiscardAssembly() throws {
    let body = Data("a".utf8)
    let descriptor = try ChunkTransferDescriptor(
      identity: identity, purpose: "document.snapshot.response", totalBytes: 1,
      sha256: ChunkHash.sha256(body))
    let malformed = InboundChunkTransfer(descriptor: descriptor)
    XCTAssertThrowsError(
      try malformed.receive(
        ChunkDataFrame(identity: identity, index: 0, byteLength: 1, dataBase64: "YR=="))
    ) { error in XCTAssertEqual(error as? ChunkTransferError, .invalidBase64) }

    let timedOut = InboundChunkTransfer(descriptor: descriptor)
    timedOut.timeout()
    XCTAssertThrowsError(
      try timedOut.receive(
        ChunkDataFrame(identity: identity, index: 0, byteLength: 1, dataBase64: "YQ=="))
    ) { error in XCTAssertEqual(error as? ChunkTransferError, .timedOut) }
  }

  func testBase64ShapeIsRejectedBeforeDecodeForLengthAlphabetAndPadding() throws {
    let body = Data("a".utf8)
    let descriptor = try ChunkTransferDescriptor(
      identity: identity, purpose: "document.snapshot.response", totalBytes: 1,
      sha256: ChunkHash.sha256(body))
    for malformed in ["A", "!!!!", "YQ=A", "YQ==AAAA"] {
      let transfer = InboundChunkTransfer(descriptor: descriptor)
      XCTAssertThrowsError(
        try transfer.receive(
          ChunkDataFrame(
            identity: identity, index: 0, byteLength: 1, dataBase64: malformed))
      ) { error in XCTAssertEqual(error as? ChunkTransferError, .invalidBase64) }
    }
  }

  private var identity: ChunkTransferIdentity {
    ChunkTransferIdentity(
      requestID: requestID, sessionID: sessionID, sessionGeneration: 1,
      revision: 0, transferID: transferID)
  }
}
