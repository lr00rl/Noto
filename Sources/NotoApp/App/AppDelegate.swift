import AppKit
import UniformTypeIdentifiers

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var windowController: NSWindowController?
  private var documentSession: DocumentSession?
  private var editorViewController: EditorViewController?
  private let bookmarkStore = SecurityScopedBookmarkStore()

  func applicationDidFinishLaunching(_ notification: Notification) {
    installMainMenu()

    let contentViewController = EditorViewController()
    let window = NSWindow(contentViewController: contentViewController)
    window.title = "Noto"
    window.setContentSize(NSSize(width: 960, height: 720))
    window.minSize = NSSize(width: 720, height: 480)
    window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
    window.center()

    let controller = NSWindowController(window: window)
    editorViewController = contentViewController
    windowController = controller
    controller.showWindow(nil)
    NSApplication.shared.activate(ignoringOtherApps: true)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard documentSession?.isDirty == true else { return .terminateNow }
    let alert = NSAlert()
    alert.messageText = "Discard unsaved changes?"
    alert.informativeText = "The current document has changes that have not been saved."
    alert.addButton(withTitle: "Cancel")
    alert.addButton(withTitle: "Discard Changes")
    return alert.runModal() == .alertSecondButtonReturn ? .terminateNow : .terminateCancel
  }

  func applicationWillTerminate(_ notification: Notification) {
    documentSession?.close()
  }

  @objc private func openDocument(_ sender: Any?) {
    guard documentSession?.isDirty != true else {
      NSSound.beep()
      return
    }
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.plainText]
    panel.allowsMultipleSelection = false
    panel.canChooseDirectories = false
    guard panel.runModal() == .OK, let url = panel.url else { return }
    do {
      let bookmark = try bookmarkStore.save(url: url, identifier: "active-document")
      let session = DocumentSession(fileURL: url, bookmark: bookmark)
      try session.open()
      documentSession?.close()
      documentSession = session
      let editor = EditorViewController(session: session)
      editorViewController = editor
      windowController?.contentViewController = editor
      windowController?.window?.title = url.lastPathComponent
    } catch {
      NSSound.beep()
    }
  }

  @objc private func saveDocument(_ sender: Any?) {
    guard documentSession?.isDirty == true else { return }
    editorViewController?.saveDocument()
  }

  private func installMainMenu() {
    let mainMenu = NSMenu()
    let appMenuItem = NSMenuItem()
    mainMenu.addItem(appMenuItem)

    let appMenu = NSMenu()
    appMenu.addItem(
      withTitle: "Quit Noto",
      action: #selector(NSApplication.terminate(_:)),
      keyEquivalent: "q"
    )
    appMenuItem.submenu = appMenu

    let fileMenuItem = NSMenuItem()
    mainMenu.addItem(fileMenuItem)
    let fileMenu = NSMenu(title: "File")
    fileMenu.addItem(
      withTitle: "Open…", action: #selector(openDocument(_:)), keyEquivalent: "o")
    fileMenu.addItem(
      withTitle: "Save", action: #selector(saveDocument(_:)), keyEquivalent: "s")
    fileMenuItem.submenu = fileMenu
    NSApplication.shared.mainMenu = mainMenu
  }
}
