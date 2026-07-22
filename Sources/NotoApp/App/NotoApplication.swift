import AppKit

@main
enum NotoApplication {
  @MainActor
  static func main() {
    let application = NSApplication.shared
    let delegate = AppDelegate()

    application.setActivationPolicy(.regular)
    application.delegate = delegate
    application.run()

    withExtendedLifetime(delegate) {}
  }
}
