import Foundation

enum MarkdownLineEnding: Equatable, Sendable {
  case none
  case lineFeed
  case carriageReturnLineFeed
  case carriageReturn
  case mixed
}

enum MarkdownEnvelopeError: Error, Equatable, LocalizedError, Sendable {
  case bodyTooLarge(actualBytes: Int, maximumBytes: Int)
  case invalidUTF8
  case containsNUL
  case containsInteriorByteOrderMark

  var errorDescription: String? {
    switch self {
    case .bodyTooLarge(let actualBytes, let maximumBytes):
      return "Markdown is \(actualBytes) bytes; the maximum is \(maximumBytes) bytes."
    case .invalidUTF8:
      return "Markdown must be valid UTF-8."
    case .containsNUL:
      return "Markdown must not contain NUL characters."
    case .containsInteriorByteOrderMark:
      return "A UTF-8 byte-order mark is only permitted at the start of a file."
    }
  }
}

struct MarkdownEnvelope: Equatable, Sendable {
  static let maximumByteCount = 16 * 1_024 * 1_024

  let text: String
  let hadByteOrderMark: Bool
  let lineEnding: MarkdownLineEnding
  let hadFinalNewline: Bool

  private let originalData: Data
  private let preferredLineEnding: MarkdownLineEnding

  init(data: Data, maximumByteCount: Int = MarkdownEnvelope.maximumByteCount) throws {
    guard data.count <= maximumByteCount else {
      throw MarkdownEnvelopeError.bodyTooLarge(
        actualBytes: data.count,
        maximumBytes: maximumByteCount
      )
    }

    let byteOrderMark = Data([0xEF, 0xBB, 0xBF])
    let hadByteOrderMark = data.starts(with: byteOrderMark)
    let content = hadByteOrderMark ? data.dropFirst(byteOrderMark.count) : data[...]

    guard !content.contains(0) else {
      throw MarkdownEnvelopeError.containsNUL
    }
    guard content.range(of: byteOrderMark) == nil else {
      throw MarkdownEnvelopeError.containsInteriorByteOrderMark
    }
    guard let decoded = String(data: content, encoding: .utf8) else {
      throw MarkdownEnvelopeError.invalidUTF8
    }

    let analysis = Self.analyzeLineEndings(in: decoded)
    self.text = Self.normalizeLineEndings(in: decoded)
    self.hadByteOrderMark = hadByteOrderMark
    self.lineEnding = analysis.classification
    self.hadFinalNewline = analysis.hadFinalNewline
    self.originalData = data
    self.preferredLineEnding = analysis.preferred
  }

  func encodedData(
    for candidateText: String,
    maximumByteCount: Int = MarkdownEnvelope.maximumByteCount
  ) throws -> Data {
    let normalized = Self.normalizeLineEndings(in: candidateText)
    guard !normalized.unicodeScalars.contains(where: { $0.value == 0 }) else {
      throw MarkdownEnvelopeError.containsNUL
    }
    guard !normalized.unicodeScalars.contains(where: { $0.value == 0xFEFF }) else {
      throw MarkdownEnvelopeError.containsInteriorByteOrderMark
    }

    if normalized == text {
      return originalData
    }

    let separator: String
    switch preferredLineEnding {
    case .carriageReturnLineFeed:
      separator = "\r\n"
    case .carriageReturn:
      separator = "\r"
    case .none, .lineFeed, .mixed:
      separator = "\n"
    }

    let rendered =
      separator == "\n"
      ? normalized
      : normalized.replacingOccurrences(of: "\n", with: separator)
    var result = Data()
    if hadByteOrderMark {
      result.append(contentsOf: [0xEF, 0xBB, 0xBF])
    }
    result.append(contentsOf: rendered.utf8)

    guard result.count <= maximumByteCount else {
      throw MarkdownEnvelopeError.bodyTooLarge(
        actualBytes: result.count,
        maximumBytes: maximumByteCount
      )
    }
    return result
  }

  private static func normalizeLineEndings(in text: String) -> String {
    text
      .replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")
  }

  private static func analyzeLineEndings(
    in text: String
  ) -> (classification: MarkdownLineEnding, preferred: MarkdownLineEnding, hadFinalNewline: Bool) {
    var kinds: [MarkdownLineEnding] = []
    let bytes = Array(text.utf8)
    var index = 0
    while index < bytes.count {
      switch bytes[index] {
      case 0x0D:
        let next = index + 1
        if next < bytes.count, bytes[next] == 0x0A {
          kinds.append(.carriageReturnLineFeed)
          index += 2
        } else {
          kinds.append(.carriageReturn)
          index += 1
        }
      case 0x0A:
        kinds.append(.lineFeed)
        index += 1
      default:
        index += 1
      }
    }

    let distinctKinds = Set(kinds)
    let classification: MarkdownLineEnding
    if distinctKinds.isEmpty {
      classification = .none
    } else if distinctKinds.count == 1 {
      classification = kinds[0]
    } else {
      classification = .mixed
    }

    let counts = Dictionary(grouping: kinds, by: { $0 }).mapValues(\.count)
    let highestCount = counts.values.max() ?? 0
    let preferred = kinds.first(where: { counts[$0] == highestCount }) ?? .lineFeed
    let hadFinalNewline = text.hasSuffix("\n") || text.hasSuffix("\r")
    return (classification, preferred, hadFinalNewline)
  }
}
