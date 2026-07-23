import Foundation

enum EditorProtocolV1 {
  static let version = 1
  static let maximumSafeInteger: UInt64 = 9_007_199_254_740_991
  static let maximumBodyBytes = 16_777_216
  static let minimumChunkBytes = 262_144
  static let maximumChunkBytes = 524_288
  static let defaultChunkBytes = 262_144
  static let maximumControlMessageBytes = 1_048_576
}

enum EditorMessageType: String, CaseIterable, Sendable {
  case editorReady = "editor.ready"
  case editorDelta = "editor.delta"
  case editorCheckpoint = "editor.checkpoint"
  case documentOpen = "document.open"
  case documentSnapshotRequest = "document.snapshot.request"
  case documentSnapshotResponse = "document.snapshot.response"
  case documentSaved = "document.saved"
  case documentSaveFailed = "document.saveFailed"
  case documentExternalChange = "document.externalChange"
  case themeSet = "theme.set"
  case chunkBegin = "chunk.begin"
  case chunkData = "chunk.data"
  case chunkAck = "chunk.ack"
  case chunkEnd = "chunk.end"
  case error
}

enum EditorProtocolError: Error, Equatable, Sendable {
  case controlMessageTooLarge
  case invalidJSON
  case invalidEnvelope
  case unsupportedVersion
  case unknownMessageType
  case invalidPayload
}

enum JSONValue: Equatable, Sendable {
  case string(String)
  case integer(UInt64)
  case bool(Bool)
  case array([JSONValue])
  case object([String: JSONValue])
  case null

  init(any value: Any) throws {
    if let number = value as? NSNumber {
      if CFGetTypeID(number) == CFBooleanGetTypeID() {
        self = .bool(number.boolValue)
        return
      }
      let double = number.doubleValue
      guard double.isFinite, double.rounded(.towardZero) == double, double >= 0,
        double <= Double(EditorProtocolV1.maximumSafeInteger)
      else { throw EditorProtocolError.invalidJSON }
      self = .integer(UInt64(double))
      return
    }
    switch value {
    case let value as String:
      self = .string(value)
    case let value as [Any]:
      self = .array(try value.map(JSONValue.init(any:)))
    case let value as [String: Any]:
      self = .object(try value.mapValues(JSONValue.init(any:)))
    case is NSNull:
      self = .null
    default:
      throw EditorProtocolError.invalidJSON
    }
  }

  var foundationObject: Any {
    switch self {
    case .string(let value): value
    case .integer(let value): NSNumber(value: value)
    case .bool(let value): NSNumber(value: value)
    case .array(let value): value.map(\.foundationObject)
    case .object(let value): value.mapValues(\.foundationObject)
    case .null: NSNull()
    }
  }
}

struct EditorMessage: Equatable, Sendable {
  let type: EditorMessageType
  let requestID: UUID
  let sessionID: UUID
  let sessionGeneration: UInt64
  let revision: UInt64
  let payload: [String: JSONValue]

  init(
    type: EditorMessageType,
    requestID: UUID,
    sessionID: UUID,
    sessionGeneration: UInt64,
    revision: UInt64,
    payload: [String: JSONValue]
  ) throws {
    guard (1...EditorProtocolV1.maximumSafeInteger).contains(sessionGeneration),
      revision <= EditorProtocolV1.maximumSafeInteger
    else { throw EditorProtocolError.invalidEnvelope }
    try EditorProtocolCodec.validatePayload(type: type, revision: revision, payload: payload)
    self.type = type
    self.requestID = requestID
    self.sessionID = sessionID
    self.sessionGeneration = sessionGeneration
    self.revision = revision
    self.payload = payload
  }

  var foundationObject: [String: Any] {
    [
      "protocolVersion": EditorProtocolV1.version,
      "type": type.rawValue,
      "requestId": requestID.uuidString.lowercased(),
      "sessionId": sessionID.uuidString.lowercased(),
      "sessionGeneration": NSNumber(value: sessionGeneration),
      "revision": NSNumber(value: revision),
      "payload": payload.mapValues(\.foundationObject),
    ]
  }
}

enum EditorProtocolCodec {
  static func decode(_ data: Data) throws -> EditorMessage {
    guard data.count <= EditorProtocolV1.maximumControlMessageBytes else {
      throw EditorProtocolError.controlMessageTooLarge
    }
    let root: Any
    do {
      root = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    } catch {
      throw EditorProtocolError.invalidJSON
    }
    return try decode(root)
  }

  static func decode(_ root: Any) throws -> EditorMessage {
    guard JSONSerialization.isValidJSONObject(root),
      let boundedData = try? JSONSerialization.data(withJSONObject: root),
      boundedData.count <= EditorProtocolV1.maximumControlMessageBytes
    else { throw EditorProtocolError.controlMessageTooLarge }
    guard let object = root as? [String: Any],
      Set(object.keys) == [
        "protocolVersion", "type", "requestId", "sessionId", "sessionGeneration", "revision",
        "payload",
      ],
      integer(object["protocolVersion"]) == UInt64(EditorProtocolV1.version)
    else { throw EditorProtocolError.invalidEnvelope }
    guard let rawType = object["type"] as? String,
      let type = EditorMessageType(rawValue: rawType)
    else { throw EditorProtocolError.unknownMessageType }
    guard let requestID = uuid(object["requestId"]), let sessionID = uuid(object["sessionId"]),
      let generation = integer(object["sessionGeneration"]), generation >= 1,
      let revision = integer(object["revision"]),
      let rawPayload = object["payload"] as? [String: Any]
    else { throw EditorProtocolError.invalidEnvelope }
    let payload = try rawPayload.mapValues(JSONValue.init(any:))
    return try EditorMessage(
      type: type, requestID: requestID, sessionID: sessionID, sessionGeneration: generation,
      revision: revision, payload: payload)
  }

  static func encode(_ message: EditorMessage) throws -> Data {
    try JSONSerialization.data(withJSONObject: message.foundationObject, options: [.sortedKeys])
  }

  static func validatePayload(
    type: EditorMessageType, revision: UInt64, payload: [String: JSONValue]
  ) throws {
    func keys(_ expected: Set<String>) throws {
      guard Set(payload.keys) == expected else { throw EditorProtocolError.invalidPayload }
    }
    func uuid(_ key: String) -> Bool {
      guard case .string(let value) = payload[key] else { return false }
      return self.uuid(value) != nil
    }
    func integer(_ key: String, maximum: UInt64 = EditorProtocolV1.maximumSafeInteger) -> UInt64? {
      guard case .integer(let value) = payload[key], value <= maximum else { return nil }
      return value
    }
    func string(_ key: String) -> String? {
      guard case .string(let value) = payload[key] else { return nil }
      return value
    }
    func sha(_ key: String) -> Bool { string(key).map(isSHA256) ?? false }

    switch type {
    case .editorReady:
      try keys(["capabilities"])
      guard case .array(let values) = payload["capabilities"],
        values.allSatisfy({ if case .string = $0 { true } else { false } })
      else { throw EditorProtocolError.invalidPayload }
      let capabilities = values.compactMap { value -> String? in
        guard case .string(let capability) = value else { return nil }
        return capability
      }
      guard Set(capabilities).count == capabilities.count else {
        throw EditorProtocolError.invalidPayload
      }
    case .editorDelta:
      try keys(["transactionId", "fromRevision", "toRevision", "utf8ByteLength", "sha256"])
      guard uuid("transactionId"), let from = integer("fromRevision"),
        let to = integer("toRevision"), to == from + 1, to == revision,
        integer("utf8ByteLength", maximum: UInt64(EditorProtocolV1.maximumBodyBytes)) != nil,
        sha("sha256")
      else { throw EditorProtocolError.invalidPayload }
    case .editorCheckpoint, .documentOpen, .documentSnapshotResponse:
      try keys(["transferId", "utf8ByteLength", "sha256"])
      guard uuid("transferId"),
        integer("utf8ByteLength", maximum: UInt64(EditorProtocolV1.maximumBodyBytes)) != nil,
        sha("sha256")
      else { throw EditorProtocolError.invalidPayload }
    case .documentSnapshotRequest:
      try keys(["frozenRevision"])
      guard integer("frozenRevision") == revision else { throw EditorProtocolError.invalidPayload }
    case .documentSaved:
      try keys(["durableRevision", "sha256"])
      guard integer("durableRevision") == revision, sha("sha256") else {
        throw EditorProtocolError.invalidPayload
      }
    case .documentSaveFailed, .error:
      let validKeys: Set<String> =
        payload["retryable"] == nil
        ? ["code", "message"] : ["code", "message", "retryable"]
      try keys(validKeys)
      guard let code = string("code"), !code.isEmpty, let message = string("message"),
        !message.isEmpty,
        payload["retryable"].map({ if case .bool = $0 { true } else { false } }) ?? true
      else { throw EditorProtocolError.invalidPayload }
    case .documentExternalChange:
      try keys(["kind"])
      guard let kind = string("kind"),
        ["modified", "moved", "deleted", "permissionLost"].contains(kind)
      else { throw EditorProtocolError.invalidPayload }
    case .themeSet:
      try keys(["appearance"])
      guard let appearance = string("appearance"), ["light", "dark"].contains(appearance)
      else { throw EditorProtocolError.invalidPayload }
    case .chunkBegin:
      try keys([
        "transferId", "purpose", "totalBytes", "chunkBytes", "totalChunks", "sha256", "timeoutMs",
      ])
      guard uuid("transferId"), let purpose = string("purpose"),
        ["document.open", "document.snapshot.response", "editor.checkpoint"].contains(purpose),
        let totalBytes = integer("totalBytes", maximum: UInt64(EditorProtocolV1.maximumBodyBytes)),
        let chunkBytes = integer("chunkBytes", maximum: UInt64(EditorProtocolV1.maximumChunkBytes)),
        chunkBytes >= UInt64(EditorProtocolV1.minimumChunkBytes),
        let totalChunks = integer("totalChunks", maximum: 64),
        totalChunks == max(1, (totalBytes + chunkBytes - 1) / chunkBytes), sha("sha256"),
        let timeout = integer("timeoutMs", maximum: 60_000), timeout >= 1
      else { throw EditorProtocolError.invalidPayload }
    case .chunkData:
      try keys(["transferId", "index", "byteLength", "dataBase64"])
      guard uuid("transferId"), integer("index", maximum: 63) != nil,
        integer("byteLength", maximum: UInt64(EditorProtocolV1.maximumChunkBytes)) != nil,
        string("dataBase64") != nil
      else { throw EditorProtocolError.invalidPayload }
    case .chunkAck:
      try keys(["transferId", "ackedThrough"])
      guard uuid("transferId"), integer("ackedThrough", maximum: 63) != nil else {
        throw EditorProtocolError.invalidPayload
      }
    case .chunkEnd:
      try keys(["transferId", "totalBytes", "totalChunks", "sha256"])
      guard uuid("transferId"),
        integer("totalBytes", maximum: UInt64(EditorProtocolV1.maximumBodyBytes)) != nil,
        integer("totalChunks", maximum: 64).map({ $0 >= 1 }) == true, sha("sha256")
      else { throw EditorProtocolError.invalidPayload }
    }
  }

  static func canonicalPayloadData(_ payload: [String: JSONValue]) throws -> Data {
    try JSONSerialization.data(
      withJSONObject: payload.mapValues(\.foundationObject), options: [.sortedKeys])
  }

  static func integer(_ value: Any?) -> UInt64? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
      return nil
    }
    let double = number.doubleValue
    guard double.isFinite, double.rounded(.towardZero) == double, double >= 0,
      double <= Double(EditorProtocolV1.maximumSafeInteger)
    else { return nil }
    return UInt64(double)
  }

  static func uuid(_ value: Any?) -> UUID? {
    guard let value = value as? String else { return nil }
    let pattern =
      "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
    guard value.range(of: pattern, options: .regularExpression) != nil else { return nil }
    return UUID(uuidString: value)
  }

  static func isSHA256(_ value: String) -> Bool {
    value.count == 64 && value.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
  }
}
