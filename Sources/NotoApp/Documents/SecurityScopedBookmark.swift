import Foundation

enum SecurityScopedBookmarkError: Error, Equatable, Sendable {
  case accessDenied
  case staleBookmark
}

protocol BookmarkDataResolving: Sendable {
  func createBookmark(for url: URL) throws -> Data
  func resolveBookmark(_ data: Data) throws -> (url: URL, isStale: Bool)
}

struct SystemBookmarkDataResolver: BookmarkDataResolving, Sendable {
  func createBookmark(for url: URL) throws -> Data {
    try url.bookmarkData(
      options: [.withSecurityScope],
      includingResourceValuesForKeys: nil,
      relativeTo: nil
    )
  }

  func resolveBookmark(_ data: Data) throws -> (url: URL, isStale: Bool) {
    var isStale = false
    let url = try URL(
      resolvingBookmarkData: data,
      options: [.withSecurityScope, .withoutUI],
      relativeTo: nil,
      bookmarkDataIsStale: &isStale
    )
    return (url, isStale)
  }
}

protocol SecurityScopeAccessing: Sendable {
  func startAccessing(_ url: URL) -> Bool
  func stopAccessing(_ url: URL)
}

struct SystemSecurityScopeAccessor: SecurityScopeAccessing, Sendable {
  func startAccessing(_ url: URL) -> Bool {
    url.startAccessingSecurityScopedResource()
  }

  func stopAccessing(_ url: URL) {
    url.stopAccessingSecurityScopedResource()
  }
}

struct SecurityScopedBookmark: Equatable, Sendable {
  let data: Data

  static func create(
    for url: URL,
    resolver: any BookmarkDataResolving = SystemBookmarkDataResolver()
  ) throws -> SecurityScopedBookmark {
    SecurityScopedBookmark(data: try resolver.createBookmark(for: url))
  }

  func access(
    resolver: any BookmarkDataResolving = SystemBookmarkDataResolver(),
    accessor: any SecurityScopeAccessing = SystemSecurityScopeAccessor()
  ) throws -> SecurityScopedResourceLease {
    let resolution = try resolver.resolveBookmark(data)
    guard !resolution.isStale else { throw SecurityScopedBookmarkError.staleBookmark }
    guard accessor.startAccessing(resolution.url) else {
      throw SecurityScopedBookmarkError.accessDenied
    }
    return SecurityScopedResourceLease(url: resolution.url, accessor: accessor)
  }
}

final class SecurityScopedResourceLease: @unchecked Sendable {
  let url: URL

  private let accessor: any SecurityScopeAccessing
  private let lock = NSLock()
  private var isActive = true

  fileprivate init(url: URL, accessor: any SecurityScopeAccessing) {
    self.url = url
    self.accessor = accessor
  }

  func close() {
    lock.lock()
    guard isActive else {
      lock.unlock()
      return
    }
    isActive = false
    lock.unlock()
    accessor.stopAccessing(url)
  }

  deinit {
    close()
  }
}
