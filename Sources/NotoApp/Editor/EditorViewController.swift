import AppKit
import WebKit

@MainActor
final class EditorViewController: NSViewController, WKNavigationDelegate, WKUIDelegate {
  private let schemeHandler = EditorResourceSchemeHandler()
  private var webView: WKWebView?

  override func loadView() {
    view = NSView()

    guard
      Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Editor") != nil
    else {
      showMissingBundlePlaceholder()
      return
    }

    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.setURLSchemeHandler(
      schemeHandler, forURLScheme: EditorResourceSchemeHandler.scheme)

    let editorView = WKWebView(frame: .zero, configuration: configuration)
    editorView.navigationDelegate = self
    editorView.uiDelegate = self
    editorView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(editorView)
    NSLayoutConstraint.activate([
      editorView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      editorView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      editorView.topAnchor.constraint(equalTo: view.topAnchor),
      editorView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    webView = editorView

    let entryURL = URL(string: "\(EditorResourceSchemeHandler.scheme)://bundle/index.html")!
    editorView.load(URLRequest(url: entryURL))
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
  ) {
    guard
      navigationAction.targetFrame?.isMainFrame != false,
      navigationAction.request.url?.scheme == EditorResourceSchemeHandler.scheme
    else {
      decisionHandler(.cancel)
      return
    }

    decisionHandler(.allow)
  }

  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    nil
  }

  private func showMissingBundlePlaceholder() {
    let label = NSTextField(labelWithString: "Build WebEditor to load the bundled editor surface.")
    label.textColor = .secondaryLabelColor
    label.alignment = .center
    label.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(label)
    NSLayoutConstraint.activate([
      label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
  }
}
