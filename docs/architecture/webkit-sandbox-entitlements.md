# WKWebView sandbox entitlement compatibility

## Decision

Noto remains an App Sandbox application with user-selected read/write file access. The production host also carries `com.apple.security.network.client` so WKWebView can start its auxiliary processes on macOS 26.5.1 when built with Xcode 26.5.

This is an operating-system compatibility exception. It is not a product networking feature. `com.apple.security.network.server` remains forbidden.

## Observed failure

On macOS 26.5.1 with Xcode 26.5, the sandboxed production `Noto.app` failed before page JavaScript could run. WebContent or NetworkProcess startup reported `Application does not have permission to communicate with network resources`. A trivial `return 1` call then failed with `WKErrorDomain` code 5.

The same derived build passed both the trivial JavaScript call and the real document-open transaction when App Sandbox was disabled. The editor JavaScript and bridge protocol were therefore downstream of the failure.

Apple documents `com.apple.security.network.client` as outbound socket authority. No narrower public entitlement for starting WebKit auxiliary processes is available. Removing App Sandbox would grant more authority than the compatibility exception and would discard the existing file-access boundary, so Noto keeps the sandbox.

## Compensating controls

The host entitlement is broad, but Noto does not expose it to editor content as a networking feature.

- Editor assets load only through the allowlisted `noto-editor://bundle` scheme.
- The resource handler rejects other schemes, hosts, path traversal, empty path components, and non-allowlisted extensions.
- CSP keeps `connect-src 'none'` and denies frames, workers, objects, forms, remote media, images, and fonts.
- The navigation delegate allows only the bundle-backed editor scheme in the main frame.
- The UI delegate refuses popup creation.
- Native product sources contain no URLSession, Network.framework client, or socket client.
- Editor sources contain no fetch, XHR, WebSocket, EventSource, beacon, remote HTTP resource, or `window.open` use.
- `com.apple.security.network.server` is absent.

## Verification

Build to a unique DerivedData directory and inspect the exact signed artifact:

```sh
xcodebuild -project Noto.xcodeproj -scheme Noto -configuration Debug -derivedDataPath .build/DerivedDataWebKitEntitlements build
codesign -d --entitlements :- .build/DerivedDataWebKitEntitlements/Build/Products/Debug/Noto.app
```

The signed output must contain these values:

```text
com.apple.security.app-sandbox = true
com.apple.security.files.user-selected.read-write = true
com.apple.security.network.client = true
com.apple.security.network.server is absent
```

Run the hosted release gates against another unique DerivedData directory:

```sh
xcodebuild -project Noto.xcodeproj -scheme Noto -configuration Debug -derivedDataPath .build/DerivedDataWebKitTests test -only-testing:NotoAppTests/BootstrapConfigurationTests -only-testing:NotoAppTests/EditorBridgeTests/testReleaseGateProductionSandboxCanLaunchWebKitAndEvaluateJavaScript -only-testing:NotoAppTests/EditorBridgeTests/testBundledWebEditorCompletesRealWKWebViewOpenTransaction -only-testing:NotoAppTests/EditorBridgeTests/testBundledWebEditorEditsSavesAndReopensRealMarkdownFile
```

Also launch the built `Noto.app` itself without XCTest injection and capture process and console evidence that the application remains alive while its bundled editor starts.

## Removal and revalidation trigger

Re-run the sandboxed failure comparison after any macOS or Xcode WebKit update, any change from WKWebView to another editor host, or any redesign of process isolation. Remove `com.apple.security.network.client` when a supported WebKit configuration launches and completes the real edit, save, close, and reopen proof without it. Until then, any change to this entitlement requires repeating signed-artifact inspection, the production-hosted WebKit release gates, source networking scans, and the no-XCTest launch check.
