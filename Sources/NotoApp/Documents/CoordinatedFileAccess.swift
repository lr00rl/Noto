import Foundation

protocol FileCoordinating: Sendable {
  func coordinateReading<T>(at url: URL, _ accessor: (URL) throws -> T) throws -> T
  func coordinateWriting<T>(at url: URL, _ accessor: (URL) throws -> T) throws -> T
}

struct SystemFileCoordinator: FileCoordinating, Sendable {
  func coordinateReading<T>(at url: URL, _ accessor: (URL) throws -> T) throws -> T {
    let coordinator = NSFileCoordinator(filePresenter: nil)
    var coordinationError: NSError?
    var result: Result<T, Error>?
    coordinator.coordinate(readingItemAt: url, options: [], error: &coordinationError) {
      coordinatedURL in
      result = Result { try accessor(coordinatedURL) }
    }
    if let coordinationError { throw coordinationError }
    return try result?.get() ?? { throw CocoaError(.fileReadUnknown) }()
  }

  func coordinateWriting<T>(at url: URL, _ accessor: (URL) throws -> T) throws -> T {
    let coordinator = NSFileCoordinator(filePresenter: nil)
    var coordinationError: NSError?
    var result: Result<T, Error>?
    coordinator.coordinate(
      writingItemAt: url,
      options: [.forReplacing],
      error: &coordinationError
    ) { coordinatedURL in
      result = Result { try accessor(coordinatedURL) }
    }
    if let coordinationError { throw coordinationError }
    return try result?.get() ?? { throw CocoaError(.fileWriteUnknown) }()
  }
}

struct CoordinatedFileSnapshot: Sendable {
  let data: Data
  let fingerprint: FileFingerprint
}

struct CoordinatedFileAccess: Sendable {
  private let coordinator: any FileCoordinating
  private let writer: any FileWriting

  init(
    coordinator: any FileCoordinating = SystemFileCoordinator(),
    writer: any FileWriting = AtomicFileWriter()
  ) {
    self.coordinator = coordinator
    self.writer = writer
  }

  func read(at url: URL) throws -> CoordinatedFileSnapshot {
    try coordinator.coordinateReading(at: url) { coordinatedURL in
      let data = try Data(contentsOf: coordinatedURL, options: [.mappedIfSafe])
      return CoordinatedFileSnapshot(
        data: data,
        fingerprint: try FileFingerprint.capture(at: coordinatedURL, data: data)
      )
    }
  }

  func replace(
    at url: URL,
    expectedFingerprint: FileFingerprint,
    data: Data
  ) throws -> CoordinatedFileSnapshot {
    try coordinator.coordinateWriting(at: url) { coordinatedURL in
      func validateDestination() throws {
        let currentData = try Data(contentsOf: coordinatedURL, options: [.mappedIfSafe])
        let currentFingerprint = try FileFingerprint.capture(
          at: coordinatedURL,
          data: currentData
        )
        guard currentFingerprint == expectedFingerprint else {
          throw DocumentSessionError.externalChange
        }
      }

      try validateDestination()
      try writer.write(
        data,
        to: coordinatedURL,
        validatingDestination: validateDestination
      )
      let committedData = try Data(contentsOf: coordinatedURL, options: [.mappedIfSafe])
      return CoordinatedFileSnapshot(
        data: committedData,
        fingerprint: try FileFingerprint.capture(at: coordinatedURL, data: committedData)
      )
    }
  }
}
