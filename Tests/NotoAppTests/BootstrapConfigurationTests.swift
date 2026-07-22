import Foundation
import XCTest

@testable import Noto

@MainActor
final class BootstrapConfigurationTests: XCTestCase {
  func testEditorResourceURLAcceptsOnlyBundleResources() throws {
    XCTAssertEqual(
      EditorResourceSchemeHandler.validatedRelativePath(
        for: try XCTUnwrap(URL(string: "noto-editor://bundle/index.html"))
      ),
      "index.html"
    )
    XCTAssertNil(
      EditorResourceSchemeHandler.validatedRelativePath(
        for: try XCTUnwrap(URL(string: "https://example.com/index.html"))
      )
    )
    XCTAssertNil(
      EditorResourceSchemeHandler.validatedRelativePath(
        for: try XCTUnwrap(URL(string: "noto-editor://bundle/%2E%2E/secret.json"))
      )
    )
    XCTAssertNil(
      EditorResourceSchemeHandler.validatedRelativePath(
        for: try XCTUnwrap(URL(string: "noto-editor://bundle/payload.bin"))
      )
    )
  }

  func testEntitlementsEnableSandboxWithoutNetworkAccess() throws {
    let testFileURL = URL(fileURLWithPath: #filePath)
    let repositoryRoot =
      testFileURL
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    let entitlementURL = repositoryRoot.appendingPathComponent("Sources/NotoApp/Noto.entitlements")
    let data = try Data(contentsOf: entitlementURL)
    let object = try PropertyListSerialization.propertyList(from: data, format: nil)
    let entitlements = try XCTUnwrap(object as? [String: Any])

    XCTAssertEqual(entitlements["com.apple.security.app-sandbox"] as? Bool, true)
    XCTAssertEqual(entitlements["com.apple.security.files.user-selected.read-write"] as? Bool, true)
    XCTAssertNil(entitlements["com.apple.security.network.client"])
    XCTAssertNil(entitlements["com.apple.security.network.server"])
  }
}
