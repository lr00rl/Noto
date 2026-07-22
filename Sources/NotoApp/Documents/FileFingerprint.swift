import CryptoKit
import Darwin
import Foundation

enum FileFingerprintError: Error, Sendable {
  case metadataUnavailable(url: URL, code: Int32)
}

struct FileFingerprint: Equatable, Sendable {
  let deviceID: UInt64
  let fileID: UInt64
  let byteCount: UInt64
  let modificationTimeNanoseconds: Int64
  let contentSHA256: String

  static func capture(at url: URL, data suppliedData: Data? = nil) throws -> FileFingerprint {
    var metadata = stat()
    let status = url.withUnsafeFileSystemRepresentation { path in
      guard let path else { return Int32(-1) }
      return stat(path, &metadata)
    }
    guard status == 0 else {
      throw FileFingerprintError.metadataUnavailable(url: url, code: errno)
    }

    let data = try suppliedData ?? Data(contentsOf: url, options: [.mappedIfSafe])
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let seconds = Int64(metadata.st_mtimespec.tv_sec)
    let nanoseconds = Int64(metadata.st_mtimespec.tv_nsec)

    return FileFingerprint(
      deviceID: UInt64(metadata.st_dev),
      fileID: UInt64(metadata.st_ino),
      byteCount: UInt64(metadata.st_size),
      modificationTimeNanoseconds: seconds * 1_000_000_000 + nanoseconds,
      contentSHA256: digest
    )
  }
}
