import AppKit
import WebKit

@MainActor
final class EditorViewController: NSViewController, WKNavigationDelegate, WKUIDelegate,
  WKScriptMessageHandler
{
  private let schemeHandler = EditorResourceSchemeHandler()
  private let session: DocumentSession?
  private var webView: WKWebView?
  private var transport: WebKitEditorJavaScriptTransport?
  private var bridge: EditorBridge?
  private let authorityRetirementHandler: (@MainActor () -> Void)?
  private(set) var hasUnresolvedAuthority = false

  init(
    session: DocumentSession? = nil,
    authorityRetirementHandler: (@MainActor () -> Void)? = nil
  ) {
    self.session = session
    self.authorityRetirementHandler = authorityRetirementHandler
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func loadView() {
    view = NSView()
    session?.setAuthorityConflictHandler { [weak self] in self?.retireAuthority() }

    guard
      Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Editor") != nil
    else {
      showMissingBundlePlaceholder()
      return
    }

    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.userContentController.add(self, name: "notoBridge")
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
    if let session {
      let transport = WebKitEditorJavaScriptTransport(webView: editorView)
      self.transport = transport
      bridge = EditorBridge(session: session, transport: transport) { [weak self] in
        self?.retireAuthority()
      }
    }

    let entryURL = URL(string: "\(EditorResourceSchemeHandler.scheme)://bundle/index.html")!
    editorView.load(URLRequest(url: entryURL))
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard let bridge else { return }
    Task { @MainActor in
      do { try await bridge.bootstrap() } catch { retireAuthority() }
    }
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard message.name == "notoBridge", let bridge else { return }
    Task { @MainActor in
      do {
        try await bridge.receive(message.body)
      } catch {
        if bridge.state == .desynchronized { retireAuthority() }
      }
    }
  }

  func saveDocument() {
    guard let bridge else {
      NSSound.beep()
      return
    }
    Task { @MainActor in
      do { try await bridge.requestSave() } catch { NSSound.beep() }
    }
  }

  override func viewDidDisappear() {
    session?.setAuthorityConflictHandler(nil)
    bridge?.invalidate()
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "notoBridge")
    super.viewDidDisappear()
  }

  func retireAuthority() {
    guard !hasUnresolvedAuthority else { return }
    hasUnresolvedAuthority = true
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "notoBridge")
    webView?.stopLoading()
    webView?.navigationDelegate = nil
    webView?.uiDelegate = nil
    webView?.removeFromSuperview()
    webView = nil
    transport = nil
    bridge?.invalidate()
    bridge = nil
    showAuthorityErrorPlaceholder()
    authorityRetirementHandler?()
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

  private func showAuthorityErrorPlaceholder() {
    let label = NSTextField(labelWithString: "Editing stopped because document authority was lost.")
    label.textColor = .systemRed
    label.alignment = .center
    label.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(label)
    NSLayoutConstraint.activate([
      label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
  }
}
