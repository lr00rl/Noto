import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var windowController: NSWindowController?

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
    windowController = controller
    controller.showWindow(nil)
    NSApplication.shared.activate(ignoringOtherApps: true)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
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
    NSApplication.shared.mainMenu = mainMenu
  }
}
