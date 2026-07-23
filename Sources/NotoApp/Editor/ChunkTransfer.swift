import CryptoKit
import Foundation

enum ChunkTransferError: Error, Equatable, Sendable {
  case bodyTooLarge
  case invalidChunkSize
  case countMismatch
  case concurrentTransfer
  case wrongIdentity
  case outOfOrder
  case backpressureViolation
  case lengthMismatch
  case invalidBase64
  case missingChunk
  case referenceMismatch
  case hashMismatch
  case timedOut
  case cancelled
}

struct ChunkTransferIdentity: Equatable, Sendable {
  let requestID: UUID
  let sessionID: UUID
  let sessionGeneration: UInt64
  let revision: UInt64
  let transferID: UUID
}

struct ChunkTransferDescriptor: Equatable, Sendable {
  let identity: ChunkTransferIdentity
  let purpose: String
  let totalBytes: Int
  let chunkBytes: Int
  let totalChunks: Int
  let sha256: String
  let timeoutMilliseconds: Int

  init(
    identity: ChunkTransferIdentity,
    purpose: String,
    totalBytes: Int,
    chunkBytes: Int = EditorProtocolV1.defaultChunkBytes,
    totalChunks: Int? = nil,
    sha256: String,
    timeoutMilliseconds: Int = 10_000
  ) throws {
    guard totalBytes >= 0, totalBytes <= EditorProtocolV1.maximumBodyBytes else {
      throw ChunkTransferError.bodyTooLarge
    }
    guard
      (EditorProtocolV1.minimumChunkBytes...EditorProtocolV1.maximumChunkBytes).contains(chunkBytes)
    else { throw ChunkTransferError.invalidChunkSize }
    let expected = max(1, (totalBytes + chunkBytes - 1) / chunkBytes)
    guard (totalChunks ?? expected) == expected, expected <= 64 else {
      throw ChunkTransferError.countMismatch
    }
    guard EditorProtocolCodec.isSHA256(sha256), (1...60_000).contains(timeoutMilliseconds)
    else { throw ChunkTransferError.referenceMismatch }
    self.identity = identity
    self.purpose = purpose
    self.totalBytes = totalBytes
    self.chunkBytes = chunkBytes
    self.totalChunks = expected
    self.sha256 = sha256
    self.timeoutMilliseconds = timeoutMilliseconds
  }
}

struct ChunkDataFrame: Equatable, Sendable {
  let identity: ChunkTransferIdentity
  let index: Int
  let byteLength: Int
  let dataBase64: String
}

struct ChunkEndFrame: Equatable, Sendable {
  let identity: ChunkTransferIdentity
  let totalBytes: Int
  let totalChunks: Int
  let sha256: String
}

enum ChunkHash {
  static func sha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}

final class InboundChunkTransfer: @unchecked Sendable {
  private let lock = NSLock()
  private let descriptor: ChunkTransferDescriptor
  private var chunks: [Data] = []
  private var receivedBytes = 0
  private var nextIndex = 0
  private var awaitingAcknowledgement = false
  private var terminalError: ChunkTransferError?

  init(descriptor: ChunkTransferDescriptor) {
    self.descriptor = descriptor
  }

  func receive(_ frame: ChunkDataFrame) throws -> Int {
    try lock.withLock {
      try checkActive()
      guard frame.identity == descriptor.identity else { return try fail(.wrongIdentity) }
      guard !awaitingAcknowledgement else { return try fail(.backpressureViolation) }
      guard frame.index == nextIndex else { return try fail(.outOfOrder) }
      let expected =
        frame.index == descriptor.totalChunks - 1
        ? descriptor.totalBytes - descriptor.chunkBytes * frame.index : descriptor.chunkBytes
      guard frame.byteLength == expected, frame.byteLength >= 0,
        frame.byteLength <= descriptor.chunkBytes,
        receivedBytes + frame.byteLength <= descriptor.totalBytes
      else { return try fail(.lengthMismatch) }
      guard Self.hasCanonicalBase64Shape(frame.dataBase64, byteLength: frame.byteLength),
        let bytes = Data(base64Encoded: frame.dataBase64),
        bytes.count == frame.byteLength, bytes.base64EncodedString() == frame.dataBase64
      else { return try fail(.invalidBase64) }
      chunks.append(bytes)
      receivedBytes += bytes.count
      nextIndex += 1
      awaitingAcknowledgement = true
      return frame.index
    }
  }

  func didSendAcknowledgement(through index: Int) throws {
    try lock.withLock {
      try checkActive()
      guard awaitingAcknowledgement, index == nextIndex - 1 else {
        return try failVoid(.outOfOrder)
      }
      awaitingAcknowledgement = false
    }
  }

  func finish(_ frame: ChunkEndFrame) throws -> Data {
    try lock.withLock {
      try checkActive()
      guard frame.identity == descriptor.identity else { return try fail(.wrongIdentity) }
      guard !awaitingAcknowledgement, nextIndex == descriptor.totalChunks else {
        return try fail(.missingChunk)
      }
      guard frame.totalBytes == descriptor.totalBytes,
        frame.totalChunks == descriptor.totalChunks, frame.sha256 == descriptor.sha256
      else { return try fail(.referenceMismatch) }
      var body = Data(capacity: descriptor.totalBytes)
      for chunk in chunks { body.append(chunk) }
      guard body.count == descriptor.totalBytes else { return try fail(.lengthMismatch) }
      guard ChunkHash.sha256(body) == descriptor.sha256 else { return try fail(.hashMismatch) }
      chunks.removeAll(keepingCapacity: false)
      return body
    }
  }

  func timeout() { terminate(.timedOut) }
  func cancel() { terminate(.cancelled) }

  private func terminate(_ error: ChunkTransferError) {
    lock.withLock {
      guard terminalError == nil else { return }
      terminalError = error
      chunks.removeAll(keepingCapacity: false)
    }
  }

  private func checkActive() throws {
    if let terminalError { throw terminalError }
  }

  private func fail<T>(_ error: ChunkTransferError) throws -> T {
    terminalError = error
    chunks.removeAll(keepingCapacity: false)
    throw error
  }

  private func failVoid(_ error: ChunkTransferError) throws {
    terminalError = error
    chunks.removeAll(keepingCapacity: false)
    throw error
  }

  private static func hasCanonicalBase64Shape(_ value: String, byteLength: Int) -> Bool {
    guard byteLength >= 0 else { return false }
    let encodedLength = ((byteLength + 2) / 3) * 4
    let bytes = value.utf8
    guard bytes.count == encodedLength else { return false }
    if byteLength == 0 { return value.isEmpty }

    let requiredPadding = (3 - byteLength % 3) % 3
    for (index, byte) in bytes.enumerated() {
      let isPadding = index >= encodedLength - requiredPadding
      if isPadding {
        guard byte == 0x3D else { return false }
      } else {
        let isAlphabet =
          (0x41...0x5A).contains(byte) || (0x61...0x7A).contains(byte)
          || (0x30...0x39).contains(byte) || byte == 0x2B || byte == 0x2F
        guard isAlphabet else { return false }
      }
    }
    return true
  }
}

final class OutboundChunkTransfer: @unchecked Sendable {
  private let lock = NSLock()
  let descriptor: ChunkTransferDescriptor
  private let body: Data
  private var nextIndex = 0
  private var awaitingAcknowledgement: Int?
  private var terminalError: ChunkTransferError?

  init(
    identity: ChunkTransferIdentity, purpose: String, body: Data,
    chunkBytes: Int = EditorProtocolV1.defaultChunkBytes
  ) throws {
    guard body.count <= EditorProtocolV1.maximumBodyBytes else {
      throw ChunkTransferError.bodyTooLarge
    }
    self.body = body
    descriptor = try ChunkTransferDescriptor(
      identity: identity, purpose: purpose, totalBytes: body.count, chunkBytes: chunkBytes,
      sha256: ChunkHash.sha256(body))
  }

  func nextFrame() throws -> ChunkDataFrame? {
    try lock.withLock {
      try checkActive()
      guard awaitingAcknowledgement == nil else { throw ChunkTransferError.backpressureViolation }
      guard nextIndex < descriptor.totalChunks else { return nil }
      let start = nextIndex * descriptor.chunkBytes
      let end = min(start + descriptor.chunkBytes, body.count)
      let chunk = body.subdata(in: start..<end)
      let frame = ChunkDataFrame(
        identity: descriptor.identity, index: nextIndex, byteLength: chunk.count,
        dataBase64: chunk.base64EncodedString())
      awaitingAcknowledgement = nextIndex
      return frame
    }
  }

  func acknowledge(identity: ChunkTransferIdentity, through index: Int) throws {
    try lock.withLock {
      try checkActive()
      guard identity == descriptor.identity else { return try failVoid(.wrongIdentity) }
      guard awaitingAcknowledgement == index else { return try failVoid(.outOfOrder) }
      awaitingAcknowledgement = nil
      nextIndex += 1
    }
  }

  func endFrame() throws -> ChunkEndFrame {
    try lock.withLock {
      try checkActive()
      guard awaitingAcknowledgement == nil, nextIndex == descriptor.totalChunks else {
        throw ChunkTransferError.missingChunk
      }
      return ChunkEndFrame(
        identity: descriptor.identity, totalBytes: descriptor.totalBytes,
        totalChunks: descriptor.totalChunks, sha256: descriptor.sha256)
    }
  }

  func timeout() { terminate(.timedOut) }
  func cancel() { terminate(.cancelled) }

  private func terminate(_ error: ChunkTransferError) {
    lock.withLock { if terminalError == nil { terminalError = error } }
  }

  private func checkActive() throws { if let terminalError { throw terminalError } }
  private func failVoid(_ error: ChunkTransferError) throws {
    terminalError = error
    throw error
  }
}
