import AppKit
import Foundation
import WebKit
import XCTest

@testable import Noto

@MainActor
final class EditorBridgeTests: XCTestCase {
  func testReleaseGateProductionSandboxCanLaunchWebKitAndEvaluateJavaScript() async throws {
    // This intentionally isolates the WebKit process prerequisite from the editor protocol.
    let controller = EditorViewController()
    let window = makeEditorWindow(controller)
    defer { window.close() }
    let webView = try privateWebView(in: controller)
    try await Task.sleep(for: .milliseconds(250))
    let raw = try await webView.callAsyncJavaScript(
      "return 1",
      arguments: [:],
      in: nil,
      contentWorld: .page
    )
    XCTAssertEqual(raw as? NSNumber, 1)
  }

  func testJavaScriptResultParsingIsStrict() throws {
    XCTAssertEqual(
      try EditorJavaScriptResult.decode(["decision": "acceptBootstrap"]),
      EditorJavaScriptResult(decision: "acceptBootstrap", outcome: nil, response: nil))
    XCTAssertEqual(
      try EditorJavaScriptResult.decode(
        #"{"decision":"completed","outcome":"completed"}"#),
      EditorJavaScriptResult(decision: "completed", outcome: .completed, response: nil))
    XCTAssertThrowsError(
      try EditorJavaScriptResult.decode(["decision": "acceptBootstrap", "extra": true]))
    XCTAssertThrowsError(
      try EditorJavaScriptResult.decode(["decision": "completed", "outcome": "unknown"]))
    XCTAssertThrowsError(try EditorJavaScriptResult.decode(["outcome": "completed"]))
    XCTAssertThrowsError(try EditorJavaScriptResult.decode("{invalid"))
    XCTAssertThrowsError(try EditorJavaScriptResult.decode(#"["acceptBootstrap"]"#))
  }

  func testWebKitTransportUsesDirectCallAsyncJavaScriptArgumentNames() throws {
    let sourceURL = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent("Sources/NotoApp/Editor/EditorBridge.swift")
    let source = try String(
      contentsOf: sourceURL, encoding: .utf8)
    XCTAssertTrue(
      source.contains("JSON.stringify(globalThis.notoBridge.bootstrap(command))"))
    XCTAssertTrue(
      source.contains("JSON.stringify(globalThis.notoBridge.receive(message))"))
    XCTAssertFalse(source.contains("arguments.command"))
    XCTAssertFalse(source.contains("arguments.message"))
  }

  func testBootstrapRequiresAcceptAndOpenReplaysExactEnvelopeUntilCompleted() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)

    try await driveBridgeToEditing(bridge, transport: transport)

    XCTAssertEqual(transport.bootstrapCalls, 1)
    XCTAssertEqual(bridge.state, .editing)
    XCTAssertEqual(session.state, .editing)
    let opens = transport.messages.filter { $0.type == .documentOpen }
    XCTAssertEqual(opens.count, 2)
    XCTAssertEqual(opens[0], opens[1])
    XCTAssertEqual(transport.messages.filter { $0.type == .chunkEnd }.count, 1)
    await assertThrowsErrorAsync(try await bridge.bootstrap())
  }

  func testBundledWebEditorCompletesRealWKWebViewOpenTransaction() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("# Noto\n\n真实文件。\n".utf8))
    let session = makeSession(fixture)
    try session.open()

    let viewController = EditorViewController(session: session)
    let window = NSWindow(contentViewController: viewController)
    window.setContentSize(NSSize(width: 800, height: 600))
    window.orderFront(nil)
    defer { window.close() }

    for _ in 0..<200 where session.state != .editing && !viewController.hasUnresolvedAuthority {
      try await Task.sleep(for: .milliseconds(25))
    }

    XCTAssertEqual(session.state, .editing)
    XCTAssertFalse(viewController.hasUnresolvedAuthority)
  }

  func testBundledWebEditorEditsSavesAndReopensRealMarkdownFile() async throws {
    let initialData = Data("# Original\n\nOpened from disk.\n".utf8)
    let editedData = Data("# Saved\n\nEdited through CodeMirror.\n".utf8)
    let editedText = try XCTUnwrap(String(data: editedData, encoding: .utf8))
    let fixture = try BridgeTemporaryFixture(data: initialData)

    let firstSession = makeSession(fixture)
    try firstSession.open()
    let firstController = EditorViewController(session: firstSession)
    let firstWindow = makeEditorWindow(firstController)
    let firstWebView = try privateWebView(in: firstController)
    defer {
      firstWindow.close()
      firstSession.close()
    }

    try await waitUntil(
      "first editor open",
      diagnostic: {
        "session=\(firstSession.state), authority=\(firstController.hasUnresolvedAuthority)"
      }
    ) {
      firstSession.state == .editing || firstController.hasUnresolvedAuthority
    }
    XCTAssertEqual(firstSession.state, .editing)
    XCTAssertFalse(firstController.hasUnresolvedAuthority)

    let editResult = try await firstWebView.callAsyncJavaScript(
      #"""
      const content = document.querySelector(".cm-content");
      if (!(content instanceof HTMLElement)) return "missingContent";
      content.focus();
      if (content.getAttribute("contenteditable") !== "true") return "notEditable";
      content.focus();
      const selection = window.getSelection();
      if (selection === null) return "missingSelection";
      const range = document.createRange();
      range.selectNodeContents(content);
      selection.removeAllRanges();
      selection.addRange(range);
      return document.execCommand("insertText", false, replacement)
        ? "editDispatched"
        : "editRejected";
      """#,
      arguments: ["replacement": editedText],
      in: nil,
      contentWorld: .page
    )
    XCTAssertEqual(editResult as? String, "editDispatched")

    try await waitUntil(
      "revision 1 dirty state",
      diagnostic: {
        "session=\(firstSession.state), editorRevision=\(firstSession.editorRevision), "
          + "acceptedRevision=\(firstSession.acceptedRevision), dirty=\(firstSession.isDirty)"
      }
    ) {
      firstSession.editorRevision == 1 && firstSession.isDirty
    }
    XCTAssertEqual(firstSession.acceptedRevision, 0)

    firstController.saveDocument()
    for _ in 0..<200
    where firstSession.state != .editing || firstSession.acceptedRevision != 1
      || firstSession.isDirty
    {
      await mainQueueDelay()
    }

    XCTAssertEqual(firstSession.state, .editing)
    XCTAssertEqual(firstSession.editorRevision, 1)
    XCTAssertEqual(firstSession.acceptedRevision, 1)
    XCTAssertFalse(firstSession.isDirty)
    XCTAssertFalse(firstController.hasUnresolvedAuthority)
    guard
      firstSession.state == .editing, firstSession.acceptedRevision == 1,
      !firstSession.isDirty, !firstController.hasUnresolvedAuthority
    else { return }
    XCTAssertEqual(try Data(contentsOf: fixture.fileURL), editedData)
    let directoryContents = try FileManager.default.contentsOfDirectory(
      at: fixture.directoryURL,
      includingPropertiesForKeys: nil
    )
    XCTAssertEqual(Set(directoryContents.map(\.lastPathComponent)), ["fixture.md"])

    firstWindow.close()
    firstSession.close()
    XCTAssertEqual(firstSession.state, .closed)

    let secondSession = makeSession(fixture)
    try secondSession.open()
    let secondController = EditorViewController(session: secondSession)
    let secondWindow = makeEditorWindow(secondController)
    let secondWebView = try privateWebView(in: secondController)
    defer {
      secondWindow.close()
      secondSession.close()
    }

    try await waitUntil(
      "reopened editor",
      diagnostic: {
        "session=\(secondSession.state), authority=\(secondController.hasUnresolvedAuthority)"
      }
    ) {
      secondSession.state == .editing || secondController.hasUnresolvedAuthority
    }
    XCTAssertEqual(secondSession.state, .editing)
    XCTAssertFalse(secondController.hasUnresolvedAuthority)
    XCTAssertEqual(Data(secondSession.text.utf8), editedData)
    XCTAssertEqual(secondSession.editorRevision, 0)
    XCTAssertEqual(secondSession.acceptedRevision, 0)
    XCTAssertFalse(secondSession.isDirty)

    let reopenedResult = try await secondWebView.callAsyncJavaScript(
      #"""
      const content = document.querySelector(".cm-content");
      if (!(content instanceof HTMLElement)) return "missingContent";
      const visibleText = Array.from(
        content.querySelectorAll(".cm-line"),
        (line) => line.textContent ?? ""
      ).join("\n");
      if (visibleText !== expected) return "contentMismatch";
      if (content.getAttribute("contenteditable") !== "true") return "notEditable";
      if (document.querySelector(".cm-editor") === null) return "missingEditor";
      return "reopened";
      """#,
      arguments: ["expected": editedText],
      in: nil,
      contentWorld: .page
    )
    XCTAssertEqual(reopenedResult as? String, "reopened")
  }

  func testBundledWebEditorProjectsMarkdownWithoutSourceOrGeometryDriftAndSavesExactBytes()
    async throws
  {
    let initialText = [
      "# Noto 投影验证 #",
      "## 二级标题",
      "### 三级标题",
      "#### 四级标题",
      "##### 五级标题",
      "###### 六级标题",
      "",
      "长篇中文与 English prose keeps one calm writing surface.",
      "A soft line",
      "continues here.",
      "A hard break  ",
      "continues exactly.",
      "",
      "Paragraph with *emphasis*, **strong**, `inline code`, and [a link](local.md).",
      "",
      "- bullet item",
      "12) ordered item",
      "",
      "> quoted source",
      "> continues here",
      "",
      "---",
      "",
      "```swift",
      "let exact = true",
      "```",
      "",
      "- [ ] deferred task stays source",
      "",
      "| deferred | table |",
      "| --- | --- |",
      "| source | visible |",
      "",
      "*malformed emphasis stays source",
      "",
      "中文长段落用于验证滚动位置与非活动兄弟块几何不会随标记显隐而漂移。",
      "Second long paragraph keeps the document taller than the hosted viewport.",
      "Third long paragraph keeps deterministic geometry around the active inline unit.",
      "Fourth long paragraph keeps deterministic geometry around the active inline unit.",
      "Fifth long paragraph keeps deterministic geometry around the active inline unit.",
      "Sixth long paragraph keeps deterministic geometry around the active inline unit.",
      "",
      "尾段 before edit",
    ].joined(separator: "\n")
    let editedText = initialText.replacingOccurrences(of: "Paragraph with", with: "Paragraph edit")
    let fixture = try BridgeTemporaryFixture(data: Data(initialText.utf8))

    let firstSession = makeSession(fixture)
    try firstSession.open()
    let firstController = EditorViewController(session: firstSession)
    let firstWindow = makeEditorWindow(firstController)
    firstWindow.setContentSize(NSSize(width: 900, height: 520))
    let firstWebView = try privateWebView(in: firstController)
    defer {
      firstWindow.close()
      firstSession.close()
    }

    try await waitUntil(
      "projected editor open",
      diagnostic: {
        "session=\(firstSession.state), authority=\(firstController.hasUnresolvedAuthority)"
      }
    ) {
      firstSession.state == .editing || firstController.hasUnresolvedAuthority
    }
    XCTAssertEqual(firstSession.state, .editing)
    XCTAssertFalse(firstController.hasUnresolvedAuthority)

    try await waitUntil("projection decorations") {
      let raw = try await firstWebView.callAsyncJavaScript(
        #"""
        return document.querySelectorAll("[data-noto-kind]").length;
        """#,
        arguments: [:], in: nil, contentWorld: .page)
      return (raw as? NSNumber)?.intValue ?? 0 > 0
    }

    let initialProjection = try await projectionSnapshot(
      in: firstWebView, scrollTarget: "emphasis", visibleText: "Paragraph with")
    XCTAssertEqual(firstSession.text, initialText)
    XCTAssertEqual(initialProjection["visibleTextPresent"] as? Bool, true)
    XCTAssertEqual((initialProjection["editorCount"] as? NSNumber)?.intValue, 1)
    XCTAssertEqual((initialProjection["contentCount"] as? NSNumber)?.intValue, 1)
    XCTAssertEqual((initialProjection["previewCount"] as? NSNumber)?.intValue, 0)
    let kinds = Set((initialProjection["kinds"] as? [String]) ?? [])
    XCTAssertTrue(
      Set([
        "paragraph", "hardBreak", "heading", "emphasis", "strong", "inlineCode",
        "link", "listItem", "blockQuote", "thematicBreak", "fencedCode",
      ]).isSubset(of: kinds),
      "Observed projection kinds: \(kinds.sorted())")
    XCTAssertGreaterThan((initialProjection["concealedMarkers"] as? NSNumber)?.intValue ?? 0, 0)
    XCTAssertEqual((initialProjection["visibleCodeChrome"] as? NSNumber)?.intValue, 0)
    XCTAssertEqual((initialProjection["activeLineTint"] as? Bool), false)
    XCTAssertEqual((initialProjection["concealedStyleFailures"] as? NSNumber)?.intValue, 0)
    XCTAssertEqual((initialProjection["revealedStyleFailures"] as? NSNumber)?.intValue, 0)
    XCTAssertGreaterThan((initialProjection["revealedMarkers"] as? NSNumber)?.intValue ?? 0, 0)
    let concealedKinds = Set((initialProjection["concealedKinds"] as? [String]) ?? [])
    XCTAssertTrue(
      Set([
        "emphasis", "strong", "inlineCode", "link", "listItem", "blockQuote",
        "thematicBreak", "fencedCode",
      ]).isSubset(of: concealedKinds),
      "Observed concealed marker kinds: \(concealedKinds.sorted())")
    XCTAssertEqual(initialProjection["blockquoteAffordance"] as? Bool, true)
    XCTAssertEqual(initialProjection["bulletAffordance"] as? Bool, true)
    XCTAssertEqual(initialProjection["thematicBreakAffordance"] as? Bool, true)
    XCTAssertEqual(initialProjection["fallbackVisible"] as? Bool, true)
    XCTAssertNotEqual((initialProjection["beforeTop"] as? NSNumber)?.doubleValue, -1)
    XCTAssertNotEqual((initialProjection["afterTop"] as? NSNumber)?.doubleValue, -1)

    let revealPreparation = try await firstWebView.callAsyncJavaScript(
      #"""
      const content = document.querySelector(".cm-content");
      if (!(content instanceof HTMLElement)) return "missingContent";
      content.focus();
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeValue !== needle) continue;
        const range = document.createRange();
        range.setStart(node, Math.min(1, node.nodeValue.length));
        range.collapse(true);
        const rect = range.getClientRects()[0];
        const target = node.parentElement;
        if (rect === undefined || target === null) return "missingTextGeometry";
        const mouse = (type, buttons) => target.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons,
          detail: 1,
          clientX: rect.left,
          clientY: rect.top + rect.height / 2,
        }));
        mouse("mousedown", 1);
        mouse("mouseup", 0);
        return "revealPrepared";
      }
      return "missingText";
      """#,
      arguments: ["needle": "emphasis"], in: nil, contentWorld: .page)
    XCTAssertEqual(revealPreparation as? String, "revealPrepared")
    try await waitUntil("active emphasis marker reveal") {
      let raw = try await firstWebView.callAsyncJavaScript(
        #"""
        return document.querySelectorAll(
          '[data-noto-kind="emphasis"][data-noto-marker-state="revealed"]'
        ).length;
        """#,
        arguments: [:], in: nil, contentWorld: .page)
      return (raw as? NSNumber)?.intValue ?? 0 > 0
    }

    let revealedProjection = try await projectionSnapshot(
      in: firstWebView, scrollTarget: nil, visibleText: "Paragraph with")
    XCTAssertEqual(firstSession.text, initialText)
    XCTAssertEqual((revealedProjection["concealedStyleFailures"] as? NSNumber)?.intValue, 0)
    XCTAssertEqual((revealedProjection["revealedStyleFailures"] as? NSNumber)?.intValue, 0)
    XCTAssertTrue(
      Set((revealedProjection["revealedKinds"] as? [String]) ?? []).contains("emphasis"))
    XCTAssertLessThanOrEqual(
      abs(
        try XCTUnwrap((revealedProjection["beforeDocumentTop"] as? NSNumber)?.doubleValue)
          - XCTUnwrap((initialProjection["beforeDocumentTop"] as? NSNumber)?.doubleValue)),
      1)
    XCTAssertLessThanOrEqual(
      abs(
        try XCTUnwrap((revealedProjection["afterDocumentTop"] as? NSNumber)?.doubleValue)
          - XCTUnwrap((initialProjection["afterDocumentTop"] as? NSNumber)?.doubleValue)),
      1)
    let initialMarkerWidths = try XCTUnwrap(
      initialProjection["markerWidths"] as? [String: NSNumber])
    let revealedMarkerWidths = try XCTUnwrap(
      revealedProjection["markerWidths"] as? [String: NSNumber])
    XCTAssertEqual(Set(initialMarkerWidths.keys), Set(revealedMarkerWidths.keys))
    for (key, initialWidth) in initialMarkerWidths {
      XCTAssertEqual(
        initialWidth.doubleValue,
        try XCTUnwrap(revealedMarkerWidths[key]).doubleValue,
        accuracy: 0.25,
        "marker geometry changed for \(key)")
    }

    let editPreparation = try await firstWebView.callAsyncJavaScript(
      #"""
      const content = document.querySelector(".cm-content");
      const scroller = document.querySelector(".cm-scroller");
      if (!(content instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
        return "missingEditorSurface";
      }
      content.focus();
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!(node.nodeValue?.includes(needle) ?? false)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        if (selection === null) return "missingSelection";
        selection.removeAllRanges();
        selection.addRange(range);
        return "editPrepared";
      }
      return "missingText";
      """#,
      arguments: ["needle": "Paragraph with"], in: nil, contentWorld: .page)
    XCTAssertEqual(editPreparation as? String, "editPrepared")
    for _ in 0..<8 { await mainQueueDelay() }

    let beforeEditProjection = try await projectionSnapshot(
      in: firstWebView, scrollTarget: nil, visibleText: "Paragraph with")
    XCTAssertEqual(beforeEditProjection["visibleTextPresent"] as? Bool, true)
    XCTAssertEqual(firstSession.editorRevision, 0)

    let editResult = try await firstWebView.callAsyncJavaScript(
      #"""
      const content = document.querySelector(".cm-content");
      if (!(content instanceof HTMLElement)) return "missingContent";
      content.focus();
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const start = node.nodeValue?.indexOf(needle) ?? -1;
        if (start < 0) continue;
        const value = node.nodeValue ?? "";
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        if (selection === null) return "missingSelection";
        selection.removeAllRanges();
        selection.addRange(range);
        const next = value.slice(0, start) + replacement + value.slice(start + needle.length);
        return document.execCommand("insertText", false, next)
          ? "editDispatched"
          : "editRejected";
      }
      return "missingText";
      """#,
      arguments: ["needle": "Paragraph with", "replacement": "Paragraph edit"],
      in: nil, contentWorld: .page)
    XCTAssertEqual(editResult as? String, "editDispatched")

    try await waitUntil(
      "projected edit revision",
      diagnostic: {
        "state=\(firstSession.state), revision=\(firstSession.editorRevision), "
          + "dirty=\(firstSession.isDirty)"
      }
    ) {
      firstSession.editorRevision == 1 && firstSession.isDirty
    }

    let afterEditProjection = try await projectionSnapshot(
      in: firstWebView, scrollTarget: nil, visibleText: "Paragraph edit")
    XCTAssertEqual(afterEditProjection["visibleTextPresent"] as? Bool, true)
    XCTAssertEqual(afterEditProjection["fallbackVisible"] as? Bool, true)
    XCTAssertLessThanOrEqual(
      abs(
        try XCTUnwrap((afterEditProjection["beforeTop"] as? NSNumber)?.doubleValue)
          - XCTUnwrap((beforeEditProjection["beforeTop"] as? NSNumber)?.doubleValue)),
      1)
    XCTAssertLessThanOrEqual(
      abs(
        try XCTUnwrap((afterEditProjection["afterTop"] as? NSNumber)?.doubleValue)
          - XCTUnwrap((beforeEditProjection["afterTop"] as? NSNumber)?.doubleValue)),
      1)
    XCTAssertLessThanOrEqual(
      abs(
        try XCTUnwrap((afterEditProjection["scrollTop"] as? NSNumber)?.doubleValue)
          - XCTUnwrap((beforeEditProjection["scrollTop"] as? NSNumber)?.doubleValue)),
      1)

    firstController.saveDocument()
    try await waitUntil(
      "projected exact save",
      diagnostic: {
        "state=\(firstSession.state), revision=\(firstSession.editorRevision), "
          + "accepted=\(firstSession.acceptedRevision), dirty=\(firstSession.isDirty)"
      }
    ) {
      firstSession.state == .editing && firstSession.acceptedRevision == 1
        && !firstSession.isDirty
    }
    XCTAssertEqual(firstSession.text, editedText)
    XCTAssertEqual(try Data(contentsOf: fixture.fileURL), Data(editedText.utf8))

    firstWindow.close()
    firstSession.close()
    XCTAssertEqual(firstSession.state, .closed)

    let secondSession = makeSession(fixture)
    try secondSession.open()
    let secondController = EditorViewController(session: secondSession)
    let secondWindow = makeEditorWindow(secondController)
    let secondWebView = try privateWebView(in: secondController)
    defer {
      secondWindow.close()
      secondSession.close()
    }

    try await waitUntil("projected reopen") {
      secondSession.state == .editing || secondController.hasUnresolvedAuthority
    }
    XCTAssertEqual(secondSession.state, .editing)
    XCTAssertEqual(secondSession.text, editedText)
    let reopened = try await projectionSnapshot(
      in: secondWebView, scrollTarget: "emphasis", visibleText: "Paragraph edit")
    XCTAssertEqual(reopened["visibleTextPresent"] as? Bool, true)
    XCTAssertEqual((reopened["editorCount"] as? NSNumber)?.intValue, 1)
    XCTAssertEqual((reopened["contentCount"] as? NSNumber)?.intValue, 1)
    XCTAssertEqual((reopened["previewCount"] as? NSNumber)?.intValue, 0)
    XCTAssertGreaterThan((reopened["concealedMarkers"] as? NSNumber)?.intValue ?? 0, 0)

    secondWindow.orderOut(nil)
    secondWindow.setContentSize(NSSize(width: 900, height: 520))
    secondController.view.layoutSubtreeIfNeeded()
    for _ in 0..<4 { await mainQueueDelay() }
    let desktopLayout = try await projectionSnapshot(
      in: secondWebView, scrollTarget: nil, visibleText: "Paragraph edit")
    assertEditorLayout(
      desktopLayout, viewportWidth: 900, contentWidth: 46 * 16,
      file: #filePath, line: #line)

    secondWindow.setContentSize(NSSize(width: 720, height: 520))
    secondController.view.layoutSubtreeIfNeeded()
    for _ in 0..<4 { await mainQueueDelay() }
    let compactLayout = try await projectionSnapshot(
      in: secondWebView, scrollTarget: nil, visibleText: "Paragraph edit")
    assertEditorLayout(
      compactLayout, viewportWidth: 720, contentWidth: 42 * 16,
      file: #filePath, line: #line)
  }

  func testRejectedBootstrapAndCachedOpenFailureAreFatal() async throws {
    let firstFixture = try BridgeTemporaryFixture(data: Data())
    let firstSession = makeSession(firstFixture)
    try firstSession.open()
    let rejectedTransport = RecordingEditorTransport()
    rejectedTransport.bootstrapResult = .init(
      decision: "rejectInvalidBootstrap", outcome: nil, response: nil)
    let rejectedBridge = EditorBridge(session: firstSession, transport: rejectedTransport)
    await assertThrowsErrorAsync(try await rejectedBridge.bootstrap())
    XCTAssertEqual(rejectedBridge.state, .desynchronized)

    let secondFixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let secondSession = makeSession(secondFixture)
    try secondSession.open()
    let failedTransport = RecordingEditorTransport()
    failedTransport.handler = { message, occurrence in
      if message.type == .documentOpen, occurrence == 2 {
        let response = try EditorMessage(
          type: .error, requestID: message.requestID, sessionID: message.sessionID,
          sessionGeneration: message.sessionGeneration, revision: message.revision,
          payload: [
            "code": .string("transferHashMismatch"),
            "message": .string("Transfer rejected"),
            "retryable": .bool(false),
          ])
        return .init(decision: "failed", outcome: .failed, response: response)
      }
      return RecordingEditorTransport.defaultResult(for: message, occurrence: occurrence)
    }
    let failedBridge = EditorBridge(session: secondSession, transport: failedTransport)
    try await failedBridge.bootstrap()
    await assertThrowsErrorAsync(
      try await sendReadyAndAcknowledgeOpen(failedBridge, transport: failedTransport))
    XCTAssertEqual(failedBridge.state, .desynchronized)
    XCTAssertEqual(secondSession.state, .ready)
  }

  func testOpenReplayExhaustionIsFatalWithoutBeginningEditing() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    transport.handler = { message, occurrence in
      if message.type == .documentOpen {
        return .init(decision: "acceptReference", outcome: nil, response: nil)
      }
      return RecordingEditorTransport.defaultResult(for: message, occurrence: occurrence)
    }
    let bridge = EditorBridge(
      session: session, transport: transport, operationTimeoutMilliseconds: 100,
      openReplayLimit: 2, openReplayDelayMilliseconds: 1)
    try await bridge.bootstrap()
    await assertThrowsErrorAsync(
      try await sendReadyAndAcknowledgeOpen(bridge, transport: transport))
    XCTAssertEqual(bridge.state, .desynchronized)
    XCTAssertEqual(session.state, .ready)
  }

  func testLateCompletedOpenCannotReviveTimedOutOperation() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    transport.handler = { message, occurrence in
      if message.type == .documentOpen, occurrence == 2 {
        try await Task.sleep(for: .milliseconds(60))
        return .init(decision: "completed", outcome: .completed, response: nil)
      }
      return RecordingEditorTransport.defaultResult(for: message, occurrence: occurrence)
    }
    let bridge = EditorBridge(
      session: session, transport: transport, operationTimeoutMilliseconds: 20,
      openReplayDelayMilliseconds: 1)
    try await bridge.bootstrap()
    await assertThrowsErrorAsync(
      try await sendReadyAndAcknowledgeOpen(bridge, transport: transport))
    XCTAssertEqual(bridge.state, .desynchronized)
    XCTAssertEqual(session.state, .ready)
  }

  func testRequestSaveRejectionClearsPendingRequest() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    transport.handler = { message, occurrence in
      if message.type == .documentSnapshotRequest {
        return .init(decision: "rejectRevisionMismatch", outcome: nil, response: nil)
      }
      return RecordingEditorTransport.defaultResult(for: message, occurrence: occurrence)
    }
    let bridge = EditorBridge(session: session, transport: transport)
    try await driveBridgeToEditing(bridge, transport: transport)

    await assertThrowsErrorAsync(try await bridge.requestSave())
    await assertThrowsErrorAsync(try await bridge.requestSave())
    XCTAssertEqual(
      transport.messages.filter { $0.type == .documentSnapshotRequest }.count, 2,
      "a rejected request must not leave the bridge permanently busy")
  }

  func testSnapshotRequestTimeoutStartsBeforeChunkBegin() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(
      session: session, transport: transport, operationTimeoutMilliseconds: 20)
    try await driveBridgeToEditing(bridge, transport: transport)
    try await bridge.requestSave()
    try await Task.sleep(for: .milliseconds(60))
    XCTAssertEqual(bridge.state, .desynchronized)
    await assertThrowsErrorAsync(try await bridge.requestSave())
  }

  func testRejectedOpenEndAndSnapshotAckAreFatal() async throws {
    let openFixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let openSession = makeSession(openFixture)
    try openSession.open()
    let openTransport = RecordingEditorTransport()
    openTransport.handler = { message, occurrence in
      if message.type == .chunkEnd {
        return .init(decision: "rejectTransferReferenceMismatch", outcome: nil, response: nil)
      }
      return RecordingEditorTransport.defaultResult(for: message, occurrence: occurrence)
    }
    let openBridge = EditorBridge(session: openSession, transport: openTransport)
    try await openBridge.bootstrap()
    await assertThrowsErrorAsync(
      try await sendReadyAndAcknowledgeOpen(openBridge, transport: openTransport))
    XCTAssertEqual(openBridge.state, .desynchronized)

    let snapshotFixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let snapshotSession = makeSession(snapshotFixture)
    try snapshotSession.open()
    let snapshotTransport = RecordingEditorTransport()
    let snapshotBridge = EditorBridge(session: snapshotSession, transport: snapshotTransport)
    try await driveBridgeToEditing(snapshotBridge, transport: snapshotTransport)
    snapshotTransport.handler = { message, occurrence in
      if message.type == .chunkAck {
        return .init(decision: "rejectLateAck", outcome: nil, response: nil)
      }
      return RecordingEditorTransport.defaultResult(for: message, occurrence: occurrence)
    }
    try await snapshotBridge.requestSave()
    let request = try XCTUnwrap(
      snapshotTransport.messages.last { $0.type == .documentSnapshotRequest })
    await assertThrowsErrorAsync(
      try await beginAndSendSnapshot(
        snapshotBridge, request: request, transferID: UUID(), data: Data("hello".utf8)))
    XCTAssertEqual(snapshotBridge.state, .desynchronized)
    XCTAssertFalse(snapshotTransport.messages.contains { $0.type == .documentSaveFailed })
  }

  func testRevisionGapCancelsSnapshotAndLateFramesCannotWrite() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("disk".utf8))
    let original = try Data(contentsOf: fixture.fileURL)
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)
    try await driveBridgeToEditing(bridge, transport: transport)
    try await bridge.requestSave()
    let request = try XCTUnwrap(transport.messages.last { $0.type == .documentSnapshotRequest })

    let changed = Data("gap".utf8)
    let gap = try editorDelta(bridge, from: 1, to: 2, data: changed)
    await assertThrowsErrorAsync(try await bridge.receive(gap.foundationObject))
    XCTAssertEqual(bridge.state, .desynchronized)

    let reference = try snapshotReference(bridge, request: request, data: changed)
    await assertThrowsErrorAsync(try await bridge.receive(reference.foundationObject))
    XCTAssertEqual(try Data(contentsOf: fixture.fileURL), original)
    XCTAssertFalse(transport.messages.contains { $0.type == .error })
  }

  func testSnapshotRevisionRSavesWhileRPlusOneRemainsDirty() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("zero".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)
    try await driveBridgeToEditing(bridge, transport: transport)
    try await bridge.requestSave()
    let request = try XCTUnwrap(transport.messages.last { $0.type == .documentSnapshotRequest })
    let snapshotData = Data("zero".utf8)
    let transferID = UUID()
    try await beginAndSendSnapshot(
      bridge, request: request, transferID: transferID, data: snapshotData)

    let newer = Data("newer".utf8)
    try await bridge.receive(try editorDelta(bridge, from: 0, to: 1, data: newer).foundationObject)
    try await endSnapshot(bridge, request: request, transferID: transferID, data: snapshotData)

    XCTAssertEqual(try Data(contentsOf: fixture.fileURL), snapshotData)
    XCTAssertEqual(session.editorRevision, 1)
    XCTAssertEqual(session.acceptedRevision, 0)
    XCTAssertTrue(session.isDirty)
    XCTAssertEqual(transport.messages.last?.type, .documentSaved)
  }

  func testExternalModificationDuringSnapshotSaveIsNotOverwritten() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("zero".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)
    try await driveBridgeToEditing(bridge, transport: transport)
    try await bridge.requestSave()
    let request = try XCTUnwrap(transport.messages.last { $0.type == .documentSnapshotRequest })
    let snapshotData = Data("zero".utf8)
    let transferID = UUID()
    try await beginAndSendSnapshot(
      bridge, request: request, transferID: transferID, data: snapshotData)

    let external = Data("external".utf8)
    try external.write(to: fixture.fileURL)
    try await endSnapshot(bridge, request: request, transferID: transferID, data: snapshotData)

    XCTAssertEqual(try Data(contentsOf: fixture.fileURL), external)
    XCTAssertEqual(session.state, .conflict)
    XCTAssertEqual(transport.messages.last?.type, .documentSaveFailed)
    XCTAssertEqual(bridge.state, .desynchronized)
  }

  func testControllerRetirementCallbackIsBlockingAndIdempotent() {
    var retirements = 0
    let controller = EditorViewController { retirements += 1 }
    controller.retireAuthority()
    controller.retireAuthority()
    XCTAssertTrue(controller.hasUnresolvedAuthority)
    XCTAssertEqual(retirements, 1)
  }

  func testUncorrelatedWebErrorDesynchronizesWithoutNativeErrorSend() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data("hello".utf8))
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)
    try await driveBridgeToEditing(bridge, transport: transport)
    let error = try EditorMessage(
      type: .error, requestID: UUID(), sessionID: bridge.sessionID,
      sessionGeneration: bridge.sessionGeneration, revision: 0,
      payload: [
        "code": .string("fatal"), "message": .string("fatal"),
        "retryable": .bool(false),
      ])
    try await bridge.receive(error.foundationObject)
    XCTAssertEqual(bridge.state, .desynchronized)
    XCTAssertFalse(transport.messages.contains { $0.type == .error })
  }

  func testInvalidateIsTerminalAndIdempotent() async throws {
    let fixture = try BridgeTemporaryFixture(data: Data())
    let session = makeSession(fixture)
    try session.open()
    let transport = RecordingEditorTransport()
    let bridge = EditorBridge(session: session, transport: transport)
    bridge.invalidate()
    bridge.invalidate()
    XCTAssertEqual(bridge.state, .invalidated)
    await assertThrowsErrorAsync(try await bridge.bootstrap())
  }

  private func driveBridgeToEditing(
    _ bridge: EditorBridge, transport: RecordingEditorTransport
  ) async throws {
    try await bridge.bootstrap()
    try await sendReadyAndAcknowledgeOpen(bridge, transport: transport)
  }

  private func makeSession(_ fixture: BridgeTemporaryFixture) -> DocumentSession {
    DocumentSession(
      fileURL: fixture.fileURL,
      bookmark: SecurityScopedBookmark(data: Data("bookmark".utf8)),
      fileAccess: CoordinatedFileAccess(coordinator: BridgePassthroughCoordinator()),
      bookmarkResolver: BridgeBookmarkResolver(url: fixture.fileURL),
      scopeAccessor: BridgeScopeAccessor(),
      monitorFactory: { url, handler in ExternalChangeMonitor(url: url, changeHandler: handler) }
    )
  }

  private func makeEditorWindow(_ viewController: EditorViewController) -> NSWindow {
    let window = NSWindow(contentViewController: viewController)
    window.setContentSize(NSSize(width: 800, height: 600))
    window.makeKeyAndOrderFront(nil)
    return window
  }

  private func privateWebView(in viewController: EditorViewController) throws -> WKWebView {
    guard
      let storedWebView = Mirror(reflecting: viewController).children.first(where: {
        $0.label == "webView"
      }),
      let webView = Mirror(reflecting: storedWebView.value).children.first?.value as? WKWebView
    else {
      throw BridgeWebEditorTestError.missingWebView
    }
    return webView
  }

  private func waitUntil(
    _ description: String,
    attempts: Int = 200,
    diagnostic: () -> String = { "" },
    condition: () async throws -> Bool
  ) async throws {
    for _ in 0..<attempts {
      if try await condition() { return }
      await mainQueueDelay()
    }
    let detail = diagnostic()
    throw BridgeWebEditorTestError.timedOut(
      detail.isEmpty ? description : "\(description): \(detail)")
  }

  private func projectionSnapshot(
    in webView: WKWebView, scrollTarget: String?, visibleText: String
  ) async throws -> [String: Any] {
    let raw = try await webView.callAsyncJavaScript(
      #"""
      const content = document.querySelector(".cm-content");
      const scroller = document.querySelector(".cm-scroller");
      if (!(content instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
        return JSON.stringify({ error: "missingEditorSurface" });
      }
      if (scrollTarget !== null) {
        const target = document.querySelector(`[data-noto-kind="${scrollTarget}"]`);
        if (target instanceof HTMLElement) target.scrollIntoView({ block: "center" });
      }
      const lines = Array.from(content.querySelectorAll(".cm-line"));
      const markers = Array.from(content.querySelectorAll("[data-noto-marker-state]"));
      const concealed = markers.filter(
        (marker) => marker.getAttribute("data-noto-marker-state") === "concealed"
      );
      const revealed = markers.filter(
        (marker) => marker.getAttribute("data-noto-marker-state") === "revealed"
      );
      const before = lines.find((line) => line.textContent?.includes("Noto 投影验证"));
      const after = lines.find((line) => line.textContent?.includes("let exact = true"));
      const codeChrome = Array.from(document.querySelectorAll(
        ".cm-gutters, .cm-gutter, .cm-lineNumbers, .cm-foldGutter"
      ));
      const isVisibleChrome = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden"
          && rect.width > 0 && rect.height > 0;
      };
      const probe = document.createElement("span");
      probe.style.color = "transparent";
      probe.style.webkitTextFillColor = "transparent";
      probe.style.textDecorationColor = "transparent";
      document.body.appendChild(probe);
      const transparentStyle = getComputedStyle(probe);
      const transparentColor = transparentStyle.color;
      const transparentFill = transparentStyle.webkitTextFillColor;
      const transparentDecoration = transparentStyle.textDecorationColor;
      probe.style.color = "var(--noto-muted-ink)";
      probe.style.webkitTextFillColor = "var(--noto-muted-ink)";
      const mutedStyle = getComputedStyle(probe);
      const mutedColor = mutedStyle.color;
      const mutedFill = mutedStyle.webkitTextFillColor;
      probe.remove();
      const styledTextNodes = (marker) => [
        marker,
        ...Array.from(marker.querySelectorAll("span")),
      ].filter((element) => element.textContent?.length > 0);
      const concealedStyleFailures = concealed.flatMap(styledTextNodes).filter((element) => {
        const style = getComputedStyle(element);
        return style.color !== transparentColor
          || style.webkitTextFillColor !== transparentFill
          || style.textDecorationColor !== transparentDecoration;
      });
      const revealedStyleFailures = revealed.flatMap(styledTextNodes).filter((element) => {
        const style = getComputedStyle(element);
        return style.color !== mutedColor || style.webkitTextFillColor !== mutedFill;
      });
      const markerWidths = {};
      for (const marker of markers) {
        const key = [
          marker.getAttribute("data-noto-unit-id"),
          marker.getAttribute("data-noto-marker"),
          marker.textContent,
        ].join("|");
        markerWidths[key] = (markerWidths[key] ?? 0) + marker.getBoundingClientRect().width;
      }
      const activeLines = Array.from(document.querySelectorAll(".cm-activeLine"));
      const activeLineTint = activeLines.some((line) => {
        const color = getComputedStyle(line).backgroundColor;
        return color !== transparentColor;
      });
      const blockquote = document.querySelector(".noto-line-block-quote");
      const bullet = document.querySelector(
        '[data-noto-marker="bullet-marker"][data-noto-marker-state="concealed"]'
      );
      const thematicBreak = document.querySelector(".noto-line-thematic-break");
      const fallbackSource = [
        "- [ ] deferred task stays source",
        "| deferred | table |",
        "*malformed emphasis stays source",
      ];
      const contentStyle = getComputedStyle(content);
      const contentRect = content.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const headingSizes = Object.fromEntries([1, 2, 3, 4, 5, 6].map((level) => {
        const heading = content.querySelector(`.noto-line-heading-${level}`);
        return [
          String(level),
          heading instanceof HTMLElement
            ? Number.parseFloat(getComputedStyle(heading).fontSize)
            : -1,
        ];
      }));
      return JSON.stringify({
        editorCount: document.querySelectorAll(".cm-editor").length,
        contentCount: document.querySelectorAll('.cm-content[contenteditable="true"]').length,
        previewCount: document.querySelectorAll(
          ".preview, .markdown-preview, [data-preview], [data-noto-preview]"
        ).length,
        visibleTextPresent: lines.some((line) => line.textContent?.includes(visibleText)),
        kinds: Array.from(
          new Set(Array.from(content.querySelectorAll("[data-noto-kind]"), (element) =>
            element.getAttribute("data-noto-kind")
          ).filter(Boolean))
        ),
        concealedMarkers: markers.filter(
          (marker) => marker.getAttribute("data-noto-marker-state") === "concealed"
        ).length,
        revealedMarkers: revealed.length,
        concealedKinds: Array.from(new Set(concealed.map(
          (marker) => marker.getAttribute("data-noto-kind")
        ).filter(Boolean))),
        revealedKinds: Array.from(new Set(revealed.map(
          (marker) => marker.getAttribute("data-noto-kind")
        ).filter(Boolean))),
        concealedStyleFailures: concealedStyleFailures.length,
        revealedStyleFailures: revealedStyleFailures.length,
        markerWidths,
        visibleCodeChrome: codeChrome.filter(isVisibleChrome).length,
        activeLineTint,
        blockquoteAffordance: blockquote instanceof HTMLElement
          && Number.parseFloat(getComputedStyle(blockquote).borderInlineStartWidth) > 0,
        bulletAffordance: bullet instanceof HTMLElement
          && Number.parseFloat(getComputedStyle(bullet, "::after").width) > 0
          && getComputedStyle(bullet, "::after").backgroundColor !== transparentColor,
        thematicBreakAffordance: thematicBreak instanceof HTMLElement
          && getComputedStyle(thematicBreak).backgroundImage !== "none",
        fallbackVisible: fallbackSource.every((expected) => {
          const line = lines.find((candidate) => candidate.textContent?.includes(expected));
          return line instanceof HTMLElement
            && line.textContent?.includes(expected) === true
            && getComputedStyle(line).visibility !== "hidden"
            && getComputedStyle(line).display !== "none";
        }),
        viewportWidth: window.innerWidth,
        viewportClientWidth: document.documentElement.clientWidth,
        scrollerClientWidth: scroller.clientWidth,
        contentWidth: contentRect.width,
        contentLeftMargin: contentRect.left - scrollerRect.left + scroller.scrollLeft,
        contentRightMargin: scrollerRect.right - contentRect.right - scroller.scrollLeft,
        contentPaddingLeft: Number.parseFloat(contentStyle.paddingLeft),
        contentPaddingRight: Number.parseFloat(contentStyle.paddingRight),
        horizontalOverflow: scroller.scrollWidth > scroller.clientWidth + 1
          || document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        bodyFontSize: Number.parseFloat(contentStyle.fontSize),
        bodyLineHeight: Number.parseFloat(contentStyle.lineHeight),
        bodyFontFamily: contentStyle.fontFamily,
        headingSizes,
        beforeTop: before?.getBoundingClientRect().top ?? -1,
        afterTop: after?.getBoundingClientRect().top ?? -1,
        beforeDocumentTop: before instanceof HTMLElement
          ? before.getBoundingClientRect().top + scroller.scrollTop
          : -1,
        afterDocumentTop: after instanceof HTMLElement
          ? after.getBoundingClientRect().top + scroller.scrollTop
          : -1,
        scrollTop: scroller.scrollTop,
      });
      """#,
      arguments: [
        "scrollTarget": scrollTarget.map { $0 as Any } ?? NSNull(),
        "visibleText": visibleText,
      ],
      in: nil, contentWorld: .page)
    let text = try XCTUnwrap(raw as? String)
    let value = try JSONSerialization.jsonObject(with: Data(text.utf8))
    return try XCTUnwrap(value as? [String: Any])
  }

  private func assertEditorLayout(
    _ snapshot: [String: Any], viewportWidth: Double, contentWidth: Double,
    file: StaticString = #filePath, line: UInt = #line
  ) {
    XCTAssertEqual(
      (snapshot["viewportWidth"] as? NSNumber)?.doubleValue ?? -1, viewportWidth,
      accuracy: 1, file: file, line: line)
    XCTAssertEqual(
      (snapshot["viewportClientWidth"] as? NSNumber)?.doubleValue ?? -1, viewportWidth,
      accuracy: 1, file: file, line: line)
    XCTAssertEqual(
      (snapshot["scrollerClientWidth"] as? NSNumber)?.doubleValue ?? -1, viewportWidth,
      accuracy: 1, file: file, line: line)
    XCTAssertEqual(
      (snapshot["contentWidth"] as? NSNumber)?.doubleValue ?? -1, contentWidth,
      accuracy: 1, file: file, line: line)
    let leftMargin = (snapshot["contentLeftMargin"] as? NSNumber)?.doubleValue ?? -1
    let rightMargin = (snapshot["contentRightMargin"] as? NSNumber)?.doubleValue ?? -1
    XCTAssertGreaterThanOrEqual(leftMargin, 0, file: file, line: line)
    XCTAssertEqual(leftMargin, rightMargin, accuracy: 1, file: file, line: line)
    XCTAssertGreaterThanOrEqual(
      (snapshot["contentPaddingLeft"] as? NSNumber)?.doubleValue ?? 0, 24,
      file: file, line: line)
    XCTAssertGreaterThanOrEqual(
      (snapshot["contentPaddingRight"] as? NSNumber)?.doubleValue ?? 0, 24,
      file: file, line: line)
    XCTAssertEqual(snapshot["horizontalOverflow"] as? Bool, false, file: file, line: line)
    XCTAssertEqual(
      (snapshot["bodyFontSize"] as? NSNumber)?.doubleValue ?? -1, 18,
      accuracy: 0.1, file: file, line: line)
    XCTAssertEqual(
      (snapshot["bodyLineHeight"] as? NSNumber)?.doubleValue ?? -1, 18 * 1.78,
      accuracy: 0.25, file: file, line: line)
    let fontFamily = snapshot["bodyFontFamily"] as? String ?? ""
    XCTAssertTrue(fontFamily.hasPrefix("ui-serif"), fontFamily, file: file, line: line)
    for family in ["Songti SC", "STSong", "Noto Serif CJK SC", "Georgia", "serif"] {
      XCTAssertTrue(fontFamily.contains(family), fontFamily, file: file, line: line)
    }
    let headingSizes = snapshot["headingSizes"] as? [String: NSNumber]
    for (level, expected) in ["1": 36, "2": 28, "3": 23, "4": 20, "5": 18, "6": 18] {
      XCTAssertEqual(
        headingSizes?[level]?.doubleValue ?? -1, Double(expected), accuracy: 0.1,
        "heading level \(level)", file: file, line: line)
    }
  }

}

private enum BridgeWebEditorTestError: Error {
  case missingWebView
  case timedOut(String)
}

@MainActor
private func mainQueueDelay() async {
  await withCheckedContinuation { continuation in
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(25)) {
      continuation.resume()
    }
  }
}

@MainActor
private func sendReadyAndAcknowledgeOpen(
  _ bridge: EditorBridge, transport: RecordingEditorTransport
) async throws {
  try await bridge.receive(
    try EditorMessage(
      type: .editorReady, requestID: UUID(), sessionID: bridge.sessionID,
      sessionGeneration: bridge.sessionGeneration, revision: 0,
      payload: ["capabilities": .array([.string("chunks-v1"), .string("revision-v1")])]
    ).foundationObject)
  let chunk = try XCTUnwrap(transport.messages.last { $0.type == .chunkData })
  try await bridge.receive(
    try EditorMessage(
      type: .chunkAck, requestID: chunk.requestID, sessionID: bridge.sessionID,
      sessionGeneration: bridge.sessionGeneration, revision: chunk.revision,
      payload: [
        "transferId": try XCTUnwrap(chunk.payload["transferId"]),
        "ackedThrough": try XCTUnwrap(chunk.payload["index"]),
      ]
    ).foundationObject)
}

@MainActor
private func editorDelta(
  _ bridge: EditorBridge, from: UInt64, to: UInt64, data: Data
) throws -> EditorMessage {
  try EditorMessage(
    type: .editorDelta, requestID: UUID(), sessionID: bridge.sessionID,
    sessionGeneration: bridge.sessionGeneration, revision: to,
    payload: [
      "transactionId": .string(UUID().uuidString.lowercased()),
      "fromRevision": .integer(from), "toRevision": .integer(to),
      "utf8ByteLength": .integer(UInt64(data.count)),
      "sha256": .string(ChunkHash.sha256(data)),
    ])
}

@MainActor
private func snapshotReference(
  _ bridge: EditorBridge, request: EditorMessage, data: Data, transferID: UUID = UUID()
) throws -> EditorMessage {
  try EditorMessage(
    type: .documentSnapshotResponse, requestID: request.requestID,
    sessionID: bridge.sessionID, sessionGeneration: bridge.sessionGeneration,
    revision: request.revision,
    payload: [
      "transferId": .string(transferID.uuidString.lowercased()),
      "utf8ByteLength": .integer(UInt64(data.count)),
      "sha256": .string(ChunkHash.sha256(data)),
    ])
}

@MainActor
private func beginAndSendSnapshot(
  _ bridge: EditorBridge, request: EditorMessage, transferID: UUID, data: Data
) async throws {
  try await bridge.receive(
    try snapshotReference(bridge, request: request, data: data, transferID: transferID)
      .foundationObject)
  try await bridge.receive(
    try EditorMessage(
      type: .chunkBegin, requestID: request.requestID, sessionID: bridge.sessionID,
      sessionGeneration: bridge.sessionGeneration, revision: request.revision,
      payload: [
        "transferId": .string(transferID.uuidString.lowercased()),
        "purpose": .string("document.snapshot.response"),
        "totalBytes": .integer(UInt64(data.count)),
        "chunkBytes": .integer(UInt64(EditorProtocolV1.defaultChunkBytes)),
        "totalChunks": .integer(1), "sha256": .string(ChunkHash.sha256(data)),
        "timeoutMs": .integer(10_000),
      ]
    ).foundationObject)
  try await bridge.receive(
    try EditorMessage(
      type: .chunkData, requestID: request.requestID, sessionID: bridge.sessionID,
      sessionGeneration: bridge.sessionGeneration, revision: request.revision,
      payload: [
        "transferId": .string(transferID.uuidString.lowercased()),
        "index": .integer(0), "byteLength": .integer(UInt64(data.count)),
        "dataBase64": .string(data.base64EncodedString()),
      ]
    ).foundationObject)
}

@MainActor
private func endSnapshot(
  _ bridge: EditorBridge, request: EditorMessage, transferID: UUID, data: Data
) async throws {
  try await bridge.receive(
    try EditorMessage(
      type: .chunkEnd, requestID: request.requestID, sessionID: bridge.sessionID,
      sessionGeneration: bridge.sessionGeneration, revision: request.revision,
      payload: [
        "transferId": .string(transferID.uuidString.lowercased()),
        "totalBytes": .integer(UInt64(data.count)), "totalChunks": .integer(1),
        "sha256": .string(ChunkHash.sha256(data)),
      ]
    ).foundationObject)
}

@MainActor
private final class RecordingEditorTransport: EditorJavaScriptTransport {
  private(set) var bootstrapCalls = 0
  private(set) var messages: [EditorMessage] = []
  var bootstrapResult = EditorJavaScriptResult(
    decision: "acceptBootstrap", outcome: nil, response: nil)
  var handler: ((EditorMessage, Int) async throws -> EditorJavaScriptResult)?
  private var occurrences: [EditorMessageType: Int] = [:]

  func bootstrap(sessionID: UUID, generation: UInt64) async throws -> EditorJavaScriptResult {
    bootstrapCalls += 1
    return bootstrapResult
  }

  func receive(_ message: EditorMessage) async throws -> EditorJavaScriptResult {
    messages.append(message)
    occurrences[message.type, default: 0] += 1
    let occurrence = occurrences[message.type, default: 0]
    return try await handler?(message, occurrence)
      ?? Self.defaultResult(for: message, occurrence: occurrence)
  }

  static func defaultResult(
    for message: EditorMessage, occurrence: Int
  ) -> EditorJavaScriptResult {
    switch message.type {
    case .documentOpen:
      return .init(
        decision: occurrence == 1 ? "acceptReference" : "completed",
        outcome: occurrence == 1 ? nil : .completed, response: nil)
    case .chunkBegin: return .init(decision: "acceptBegin", outcome: nil, response: nil)
    case .chunkData: return .init(decision: "acceptChunk", outcome: nil, response: nil)
    case .chunkEnd:
      return .init(decision: "acceptEndPendingValidation", outcome: nil, response: nil)
    case .chunkAck: return .init(decision: "acceptAck", outcome: nil, response: nil)
    case .documentSnapshotRequest:
      return .init(decision: "acceptSnapshot", outcome: nil, response: nil)
    case .documentSaved: return .init(decision: "acceptDirty", outcome: nil, response: nil)
    case .documentSaveFailed:
      return .init(decision: "acceptSaveFailure", outcome: nil, response: nil)
    default: return .init(decision: "accept", outcome: nil, response: nil)
    }
  }
}

private struct BridgeBookmarkResolver: BookmarkDataResolving {
  let url: URL
  func createBookmark(for url: URL) throws -> Data { Data() }
  func resolveBookmark(_ data: Data) throws -> (url: URL, isStale: Bool) { (url, false) }
}

private struct BridgeScopeAccessor: SecurityScopeAccessing {
  func startAccessing(_ url: URL) -> Bool { true }
  func stopAccessing(_ url: URL) {}
}

private struct BridgePassthroughCoordinator: FileCoordinating {
  func coordinateReading<T>(at url: URL, _ accessor: (URL) throws -> T) throws -> T {
    try accessor(url)
  }
  func coordinateWriting<T>(at url: URL, _ accessor: (URL) throws -> T) throws -> T {
    try accessor(url)
  }
}

private final class BridgeTemporaryFixture {
  let directoryURL: URL
  let fileURL: URL

  init(data: Data) throws {
    directoryURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    fileURL = directoryURL.appendingPathComponent("fixture.md")
    try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    try data.write(to: fileURL)
  }

  deinit { try? FileManager.default.removeItem(at: directoryURL) }
}

@MainActor
private func assertThrowsErrorAsync<T>(
  _ expression: @autoclosure () async throws -> T,
  file: StaticString = #filePath,
  line: UInt = #line
) async {
  do {
    _ = try await expression()
    XCTFail("Expected error", file: file, line: line)
  } catch {}
}
