import Foundation
import Security
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

  func testProductionEntitlementsDefineOnlyTheWebKitCompatibilityException() throws {
    let entitlementURL = repositoryRoot.appendingPathComponent("Sources/NotoApp/Noto.entitlements")
    let data = try Data(contentsOf: entitlementURL)
    let object = try PropertyListSerialization.propertyList(from: data, format: nil)
    let entitlements = try XCTUnwrap(object as? [String: Any])

    XCTAssertEqual(
      Set(entitlements.keys),
      [
        "com.apple.security.app-sandbox",
        "com.apple.security.files.user-selected.read-write",
        "com.apple.security.network.client",
      ])
    XCTAssertEqual(entitlements["com.apple.security.app-sandbox"] as? Bool, true)
    XCTAssertEqual(entitlements["com.apple.security.files.user-selected.read-write"] as? Bool, true)
    XCTAssertEqual(entitlements["com.apple.security.network.client"] as? Bool, true)
    XCTAssertNil(entitlements["com.apple.security.network.server"])
  }

  func testDebugAndReleaseUseTheSingleProductionEntitlementAndHost() throws {
    let projectURL = repositoryRoot.appendingPathComponent("Noto.xcodeproj/project.pbxproj")
    let project = try String(contentsOf: projectURL, encoding: .utf8)
    let entitlementAssignments = matches(
      in: project,
      pattern: #"CODE_SIGN_ENTITLEMENTS\s*=\s*([^;]+);"#,
      captureGroup: 1
    )

    XCTAssertEqual(
      entitlementAssignments,
      ["Sources/NotoApp/Noto.entitlements", "Sources/NotoApp/Noto.entitlements"])
    XCTAssertEqual(project.occurrences(of: "ENABLE_APP_SANDBOX = YES;"), 2)
    XCTAssertEqual(
      project.occurrences(
        of: #"TEST_HOST = "$(BUILT_PRODUCTS_DIR)/Noto.app/Contents/MacOS/Noto";"#),
      2
    )
    XCTAssertEqual(project.occurrences(of: #"BUNDLE_LOADER = "$(TEST_HOST)";"#), 2)
    XCTAssertEqual(
      project.occurrences(of: #"productType = "com.apple.product-type.application";"#), 1)

    XCTAssertEqual(
      entitlementFilesInActiveRepository(),
      ["Sources/NotoApp/Noto.entitlements"],
      "The production host and its hosted tests must not gain an alternate entitlement profile."
    )
  }

  func testSignedProductionHostCarriesWebKitCompatibilityEntitlements() throws {
    XCTAssertEqual(Bundle.main.bundleIdentifier, "com.roobli.Noto")
    let entitlements = try signedEntitlementsForCurrentHost()

    XCTAssertEqual(entitlements["com.apple.security.app-sandbox"] as? Bool, true)
    XCTAssertEqual(entitlements["com.apple.security.files.user-selected.read-write"] as? Bool, true)
    XCTAssertEqual(entitlements["com.apple.security.network.client"] as? Bool, true)
    XCTAssertNil(entitlements["com.apple.security.network.server"])
  }

  func testBundledWebEditorResourcesRetainTheNetworkDenyingCSP() throws {
    let htmlURL = try XCTUnwrap(
      Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Editor")
    )
    let cssURL = try XCTUnwrap(
      Bundle.main.url(forResource: "editor", withExtension: "css", subdirectory: "Editor")
    )
    let javascriptURL = try XCTUnwrap(
      Bundle.main.url(forResource: "editor", withExtension: "js", subdirectory: "Editor")
    )
    let html = try String(contentsOf: htmlURL, encoding: .utf8)

    XCTAssertTrue(FileManager.default.fileExists(atPath: cssURL.path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: javascriptURL.path))
    XCTAssertTrue(html.contains("default-src 'self'"))
    XCTAssertTrue(html.contains("script-src 'self' noto-editor:"))
    XCTAssertTrue(
      html.contains("style-src 'self' noto-editor: 'nonce-noto-web-editor'"))
    XCTAssertTrue(html.contains("connect-src 'none'"))
    for directive in [
      "img-src 'none'", "font-src 'none'", "media-src 'none'", "object-src 'none'",
      "frame-src 'none'", "worker-src 'none'", "manifest-src 'none'", "base-uri 'none'",
      "form-action 'none'",
    ] {
      XCTAssertTrue(html.contains(directive), "Missing CSP directive: \(directive)")
    }
    XCTAssertFalse(html.contains("'unsafe-inline'"))
    XCTAssertFalse(html.contains("'unsafe-eval'"))
    XCTAssertFalse(html.contains("http://"))
    XCTAssertFalse(html.contains("https://"))
  }

  func testProductSourcesContainNoNativeOrEditorNetworkingAPI() throws {
    let nativeSource = try sourceText(
      in: repositoryRoot.appendingPathComponent("Sources/NotoApp"),
      extensions: ["swift"]
    )
    for forbidden in [
      "URLSession", "import Network", "NWConnection", "NWListener", "CFSocket",
      "Darwin.socket", "Network.framework",
    ] {
      XCTAssertFalse(nativeSource.contains(forbidden), "Native networking is forbidden: \(forbidden)")
    }

    let editorSource = try sourceText(
      in: repositoryRoot.appendingPathComponent("WebEditor/src"),
      extensions: ["html", "ts"]
    )
    for pattern in [
      #"\bfetch\s*\("#, #"\bXMLHttpRequest\b"#, #"\bWebSocket\b"#,
      #"\bEventSource\b"#, #"\bsendBeacon\b"#, #"\bwindow\.open\s*\("#,
      #"https?://"#,
    ] {
      XCTAssertTrue(
        matches(in: editorSource, pattern: pattern).isEmpty,
        "Editor networking is forbidden by source contract: \(pattern)"
      )
    }
  }

  func testEditorNavigationAndPopupDelegatesRemainClosed() throws {
    let controllerURL = repositoryRoot.appendingPathComponent(
      "Sources/NotoApp/Editor/EditorViewController.swift")
    let source = try String(contentsOf: controllerURL, encoding: .utf8)

    XCTAssertTrue(source.contains("navigationAction.targetFrame?.isMainFrame != false"))
    XCTAssertTrue(
      source.contains("navigationAction.request.url?.scheme == EditorResourceSchemeHandler.scheme"))
    XCTAssertTrue(source.contains("decisionHandler(.cancel)"))
    XCTAssertTrue(source.contains("decisionHandler(.allow)"))
    XCTAssertTrue(source.contains("createWebViewWith configuration: WKWebViewConfiguration"))
    XCTAssertTrue(
      source.contains(
        "windowFeatures: WKWindowFeatures\n  ) -> WKWebView? {\n    nil\n  }"))
  }

  private var repositoryRoot: URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  private func signedEntitlementsForCurrentHost() throws -> [String: Any] {
    var dynamicCode: SecCode?
    try checkSigningStatus(
      SecCodeCopySelf(SecCSFlags(rawValue: 0), &dynamicCode),
      operation: "SecCodeCopySelf"
    )

    var staticCode: SecStaticCode?
    try checkSigningStatus(
      SecCodeCopyStaticCode(
        try XCTUnwrap(dynamicCode), SecCSFlags(rawValue: 0), &staticCode),
      operation: "SecCodeCopyStaticCode"
    )
    let signedCode = try XCTUnwrap(staticCode)
    try checkSigningStatus(
      SecStaticCodeCheckValidity(signedCode, SecCSFlags(rawValue: 0), nil),
      operation: "SecStaticCodeCheckValidity"
    )

    var information: CFDictionary?
    try checkSigningStatus(
      SecCodeCopySigningInformation(
        signedCode, SecCSFlags(rawValue: 1 << 1), &information),
      operation: "SecCodeCopySigningInformation"
    )
    let signingInformation = try XCTUnwrap(information as? [String: Any])
    return try XCTUnwrap(
      signingInformation[kSecCodeInfoEntitlementsDict as String] as? [String: Any])
  }

  private func checkSigningStatus(_ status: OSStatus, operation: String) throws {
    guard status == errSecSuccess else {
      throw SigningInspectionError(operation: operation, status: status)
    }
  }

  private func entitlementFilesInActiveRepository() -> [String] {
    guard
      let enumerator = FileManager.default.enumerator(
        at: repositoryRoot,
        includingPropertiesForKeys: [.isDirectoryKey],
        options: [.skipsHiddenFiles]
      )
    else { return [] }

    var paths: [String] = []
    for case let url as URL in enumerator {
      if url.lastPathComponent == "node_modules" {
        enumerator.skipDescendants()
        continue
      }
      guard url.pathExtension == "entitlements" else { continue }
      paths.append(url.path.replacingOccurrences(of: repositoryRoot.path + "/", with: ""))
    }
    return paths.sorted()
  }

  private func sourceText(in directory: URL, extensions: Set<String>) throws -> String {
    guard
      let enumerator = FileManager.default.enumerator(
        at: directory,
        includingPropertiesForKeys: [.isRegularFileKey]
      )
    else { return "" }

    var source = ""
    for case let url as URL in enumerator where extensions.contains(url.pathExtension) {
      source += try String(contentsOf: url, encoding: .utf8)
      source.append("\n")
    }
    return source
  }

  private func matches(
    in source: String,
    pattern: String,
    captureGroup: Int = 0
  ) -> [String] {
    guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
    let range = NSRange(source.startIndex..<source.endIndex, in: source)
    return expression.matches(in: source, range: range).compactMap { result in
      guard
        captureGroup < result.numberOfRanges,
        let matchRange = Range(result.range(at: captureGroup), in: source)
      else { return nil }
      return String(source[matchRange])
    }
  }
}

private struct SigningInspectionError: Error {
  let operation: String
  let status: OSStatus
}

private extension String {
  func occurrences(of value: String) -> Int {
    components(separatedBy: value).count - 1
  }
}
