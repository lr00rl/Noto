import Foundation

enum ExternalChangeEvent: Equatable, Sendable {
  case changed(fingerprint: FileFingerprint?)
  case deleted
  case moved(to: URL)
}

struct ExternalChangeSnapshot: Sendable {
  let generation: UInt64
  let events: [ExternalChangeEvent]
}

final class ExternalChangeMonitor: NSObject, NSFilePresenter, @unchecked Sendable {
  let presentedItemOperationQueue: OperationQueue

  private let lock = NSLock()
  private var monitoredURL: URL
  private var registered = false
  private var eventGeneration: UInt64 = 0
  private var recordedEvents: [(generation: UInt64, event: ExternalChangeEvent)] = []
  private let changeHandler: @Sendable (ExternalChangeEvent) -> Void

  var presentedItemURL: URL? {
    lock.withLock { monitoredURL }
  }

  var isRegistered: Bool {
    lock.withLock { registered }
  }

  init(url: URL, changeHandler: @escaping @Sendable (ExternalChangeEvent) -> Void) {
    monitoredURL = url
    self.changeHandler = changeHandler
    let operationQueue = OperationQueue()
    operationQueue.name = "com.roobli.Noto.ExternalChangeMonitor"
    operationQueue.maxConcurrentOperationCount = 1
    presentedItemOperationQueue = operationQueue
    super.init()
    NSFileCoordinator.addFilePresenter(self)
    lock.withLock { registered = true }
  }

  func presentedItemDidChange() {
    let url = lock.withLock { monitoredURL }
    record(.changed(fingerprint: try? FileFingerprint.capture(at: url)))
  }

  func presentedItemDidMove(to newURL: URL) {
    lock.withLock { monitoredURL = newURL }
    record(.moved(to: newURL))
  }

  func accommodatePresentedItemDeletion(
    completionHandler: @escaping @Sendable (Error?) -> Void
  ) {
    record(.deleted)
    completionHandler(nil)
  }

  func snapshot(since generation: UInt64? = nil) -> ExternalChangeSnapshot {
    lock.withLock {
      ExternalChangeSnapshot(
        generation: eventGeneration,
        events: generation.map { baseline in
          recordedEvents.compactMap { record in
            record.generation > baseline ? record.event : nil
          }
        } ?? recordedEvents.map(\.event)
      )
    }
  }

  func acknowledge(through generation: UInt64) {
    lock.withLock {
      recordedEvents.removeAll { $0.generation <= generation }
    }
  }

  func invalidate() {
    let shouldRemove = lock.withLock {
      guard registered else { return false }
      registered = false
      return true
    }
    if shouldRemove {
      NSFileCoordinator.removeFilePresenter(self)
    }
  }

  deinit {
    invalidate()
  }

  private func record(_ event: ExternalChangeEvent) {
    lock.withLock {
      eventGeneration &+= 1
      recordedEvents.append((eventGeneration, event))
    }
    changeHandler(event)
  }
}
