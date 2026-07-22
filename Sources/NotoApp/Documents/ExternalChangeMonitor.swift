import Foundation

final class ExternalChangeMonitor: NSObject, NSFilePresenter, @unchecked Sendable {
  let presentedItemURL: URL?
  let presentedItemOperationQueue: OperationQueue

  private let changeHandler: @Sendable () -> Void

  init(url: URL, changeHandler: @escaping @Sendable () -> Void) {
    presentedItemURL = url
    self.changeHandler = changeHandler
    let operationQueue = OperationQueue()
    operationQueue.name = "com.roobli.Noto.ExternalChangeMonitor"
    operationQueue.maxConcurrentOperationCount = 1
    presentedItemOperationQueue = operationQueue
    super.init()
    NSFileCoordinator.addFilePresenter(self)
  }

  func presentedItemDidChange() {
    changeHandler()
  }

  func presentedItemDidMove(to newURL: URL) {
    changeHandler()
  }

  func accommodatePresentedItemDeletion(
    completionHandler: @escaping @Sendable (Error?) -> Void
  ) {
    changeHandler()
    completionHandler(nil)
  }

  deinit {
    NSFileCoordinator.removeFilePresenter(self)
  }
}
