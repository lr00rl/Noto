import Foundation
import UniformTypeIdentifiers
import WebKit

final class EditorResourceSchemeHandler: NSObject, WKURLSchemeHandler {
  static let scheme = "noto-editor"

  private static let permittedExtensions: Set<String> = [
    "css", "html", "js", "json", "map", "svg", "woff", "woff2",
  ]

  func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
    guard
      let url = urlSchemeTask.request.url,
      let relativePath = Self.validatedRelativePath(for: url),
      let resourceRoot = Bundle.main.resourceURL?.appendingPathComponent(
        "Editor", isDirectory: true)
    else {
      fail(urlSchemeTask, code: .badURL)
      return
    }

    let standardizedRoot = resourceRoot.standardizedFileURL
    let resourceURL = standardizedRoot.appendingPathComponent(relativePath).standardizedFileURL
    let rootPrefix =
      standardizedRoot.path.hasSuffix("/")
      ? standardizedRoot.path
      : standardizedRoot.path + "/"

    guard resourceURL.path.hasPrefix(rootPrefix) else {
      fail(urlSchemeTask, code: .noPermissionsToReadFile)
      return
    }

    do {
      let data = try Data(contentsOf: resourceURL, options: [.mappedIfSafe])
      let response = URLResponse(
        url: url,
        mimeType: Self.mimeType(for: resourceURL.pathExtension),
        expectedContentLength: data.count,
        textEncodingName: Self.isTextExtension(resourceURL.pathExtension) ? "utf-8" : nil
      )
      urlSchemeTask.didReceive(response)
      urlSchemeTask.didReceive(data)
      urlSchemeTask.didFinish()
    } catch {
      urlSchemeTask.didFailWithError(error)
    }
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {}

  static func validatedRelativePath(for url: URL) -> String? {
    guard url.scheme == scheme, url.host == "bundle" else { return nil }

    let relativePath =
      url.path.removingPercentEncoding?
      .trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
    let components = relativePath.split(separator: "/", omittingEmptySubsequences: false)

    guard
      !relativePath.isEmpty,
      !components.contains(where: { $0 == "." || $0 == ".." || $0.isEmpty }),
      permittedExtensions.contains(URL(fileURLWithPath: relativePath).pathExtension.lowercased())
    else {
      return nil
    }

    return relativePath
  }

  private static func mimeType(for pathExtension: String) -> String {
    UTType(filenameExtension: pathExtension)?.preferredMIMEType ?? "application/octet-stream"
  }

  private static func isTextExtension(_ pathExtension: String) -> Bool {
    ["css", "html", "js", "json", "map", "svg"].contains(pathExtension.lowercased())
  }

  private func fail(_ task: any WKURLSchemeTask, code: URLError.Code) {
    task.didFailWithError(URLError(code))
  }
}
