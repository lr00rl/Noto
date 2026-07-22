import Darwin
import Foundation

protocol FileWriting: Sendable {
  func write(_ data: Data, to destinationURL: URL) throws
}

protocol AtomicFileSystem: Sendable {
  func createTemporaryFile(at url: URL) throws -> Int32
  func write(_ data: Data, to descriptor: Int32) throws
  func flushFile(_ descriptor: Int32) throws
  func copyMetadata(from destinationURL: URL, to descriptor: Int32) throws
  func closeFile(_ descriptor: Int32) throws
  func replaceItem(at destinationURL: URL, with temporaryURL: URL) throws
  func flushDirectory(at directoryURL: URL) throws
  func removeItemIfPresent(at url: URL)
}

struct AtomicFileWriter: FileWriting, Sendable {
  private let fileSystem: any AtomicFileSystem

  init(fileSystem: any AtomicFileSystem = POSIXAtomicFileSystem()) {
    self.fileSystem = fileSystem
  }

  func write(_ data: Data, to destinationURL: URL) throws {
    let directoryURL = destinationURL.deletingLastPathComponent()
    let temporaryURL = directoryURL.appendingPathComponent(
      ".\(destinationURL.lastPathComponent).noto-\(UUID().uuidString).tmp"
    )

    let descriptor = try fileSystem.createTemporaryFile(at: temporaryURL)
    var descriptorIsOpen = true
    var replacementCompleted = false
    defer {
      if descriptorIsOpen {
        try? fileSystem.closeFile(descriptor)
      }
      if !replacementCompleted {
        fileSystem.removeItemIfPresent(at: temporaryURL)
      }
    }

    try fileSystem.write(data, to: descriptor)
    try fileSystem.flushFile(descriptor)
    try fileSystem.copyMetadata(from: destinationURL, to: descriptor)
    try fileSystem.flushFile(descriptor)
    try fileSystem.closeFile(descriptor)
    descriptorIsOpen = false
    try fileSystem.replaceItem(at: destinationURL, with: temporaryURL)
    replacementCompleted = true
    try fileSystem.flushDirectory(at: directoryURL)
  }
}

struct POSIXAtomicFileSystem: AtomicFileSystem, Sendable {
  func createTemporaryFile(at url: URL) throws -> Int32 {
    let descriptor = Darwin.open(
      url.path,
      O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC,
      mode_t(S_IRUSR | S_IWUSR)
    )
    guard descriptor >= 0 else { throw currentPOSIXError() }
    return descriptor
  }

  func write(_ data: Data, to descriptor: Int32) throws {
    try data.withUnsafeBytes { rawBuffer in
      guard let baseAddress = rawBuffer.baseAddress else { return }
      var writtenByteCount = 0
      while writtenByteCount < rawBuffer.count {
        let result = Darwin.write(
          descriptor,
          baseAddress.advanced(by: writtenByteCount),
          rawBuffer.count - writtenByteCount
        )
        guard result >= 0 else {
          if errno == EINTR { continue }
          throw currentPOSIXError()
        }
        writtenByteCount += result
      }
    }
  }

  func flushFile(_ descriptor: Int32) throws {
    guard Darwin.fsync(descriptor) == 0 else { throw currentPOSIXError() }
  }

  func copyMetadata(from destinationURL: URL, to descriptor: Int32) throws {
    var metadata = stat()
    let status = destinationURL.withUnsafeFileSystemRepresentation { path in
      guard let path else { return Int32(-1) }
      return stat(path, &metadata)
    }
    if status == 0 {
      guard Darwin.fchmod(descriptor, metadata.st_mode & 0o7777) == 0 else {
        throw currentPOSIXError()
      }
    } else if errno != ENOENT {
      throw currentPOSIXError()
    }
  }

  func closeFile(_ descriptor: Int32) throws {
    guard Darwin.close(descriptor) == 0 else { throw currentPOSIXError() }
  }

  func replaceItem(at destinationURL: URL, with temporaryURL: URL) throws {
    guard Darwin.rename(temporaryURL.path, destinationURL.path) == 0 else {
      throw currentPOSIXError()
    }
  }

  func flushDirectory(at directoryURL: URL) throws {
    let descriptor = Darwin.open(directoryURL.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC)
    guard descriptor >= 0 else { throw currentPOSIXError() }
    defer { Darwin.close(descriptor) }
    guard Darwin.fsync(descriptor) == 0 else { throw currentPOSIXError() }
  }

  func removeItemIfPresent(at url: URL) {
    if Darwin.unlink(url.path) != 0, errno != ENOENT {
      // Cleanup is best-effort; the original write error remains authoritative.
    }
  }

  private func currentPOSIXError() -> POSIXError {
    POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
}
