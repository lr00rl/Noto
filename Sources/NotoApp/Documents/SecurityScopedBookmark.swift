import Foundation

enum SecurityScopedBookmarkError: Error, Equatable, Sendable {
  case accessDenied
  case missingBookmark(identifier: String)
  case staleBookmark
}

protocol BookmarkPersisting: Sendable {
  func data(for identifier: String) -> Data?
  func setData(_ data: Data, for identifier: String)
  func removeData(for identifier: String)
}

struct UserDefaultsBookmarkPersistence: BookmarkPersisting, @unchecked Sendable {
  private let defaults: UserDefaults
  private let keyPrefix: String

  init(defaults: UserDefaults = .standard, keyPrefix: String = "SecurityScopedBookmark.") {
    self.defaults = defaults
    self.keyPrefix = keyPrefix
  }

  func data(for identifier: String) -> Data? {
    defaults.data(forKey: keyPrefix + identifier)
  }

  func setData(_ data: Data, for identifier: String) {
    defaults.set(data, forKey: keyPrefix + identifier)
  }

  func removeData(for identifier: String) {
    defaults.removeObject(forKey: keyPrefix + identifier)
  }
}

struct SecurityScopedBookmarkStore: Sendable {
  private let persistence: any BookmarkPersisting
  private let resolver: any BookmarkDataResolving

  init(
    persistence: any BookmarkPersisting = UserDefaultsBookmarkPersistence(),
    resolver: any BookmarkDataResolving = SystemBookmarkDataResolver()
  ) {
    self.persistence = persistence
    self.resolver = resolver
  }

  @discardableResult
  func save(url: URL, identifier: String) throws -> SecurityScopedBookmark {
    let bookmark = try SecurityScopedBookmark.create(for: url, resolver: resolver)
    persistence.setData(bookmark.data, for: identifier)
    return bookmark
  }

  func bookmark(identifier: String) throws -> SecurityScopedBookmark {
    guard let data = persistence.data(for: identifier) else {
      throw SecurityScopedBookmarkError.missingBookmark(identifier: identifier)
    }
    return SecurityScopedBookmark(data: data)
  }

  func remove(identifier: String) {
    persistence.removeData(for: identifier)
  }
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
