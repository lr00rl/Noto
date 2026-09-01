import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { EditorState } from "@codemirror/state";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");

test("source HTML enforces a bundle-only restrictive CSP", async () => {
  const html = await read("src/index.html");

  assert.match(html, /default-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /script-src 'self' noto-editor:/);
  assert.match(html, /style-src 'self' noto-editor: 'nonce-noto-web-editor'/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /unsafe-(?:inline|eval)/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
  assert.match(html, /<script defer src="\.\/editor\.js"><\/script>/);
  assert.doesNotMatch(html, /type="module"/);
  assert.doesNotMatch(html, /\sstyle=/i);
});

test("CodeMirror receives the same nonce allowed by the CSP", async () => {
  const [html, editor] = await Promise.all([read("src/index.html"), read("src/editor.ts")]);
  const nonce = html.match(/style-src 'self' noto-editor: 'nonce-([^']+)'/)?.[1];

  assert.ok(nonce);
  assert.match(editor, new RegExp(`CSP_NONCE = "${nonce}"`));
  assert.match(editor, /EditorView\.cspNonce\.of\(CSP_NONCE\)/);
});

test("production bundle contains only local HTML, CSS, and JavaScript assets", async () => {
  const outputs = (await readdir(join(root, "dist"))).sort();
  const html = await read("dist/index.html");
  const css = await read("dist/editor.css");
  const javascript = await read("dist/editor.js");

  assert.deepEqual(outputs, ["editor.css", "editor.js", "index.html"]);
  assert.match(javascript, /CodeMirror|cm-editor/);
  assert.doesNotMatch(`${html}\n${css}`, /(?:https?:|file:)\/\//);
  assert.doesNotMatch(javascript, /(?:from\s*|import\s*\()\s*["']https?:\/\//);
  assert.doesNotMatch(javascript, /\beval\s*\(/);
  assert.doesNotMatch(javascript, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(|\bwindow\.open\s*\(/);
});

test("bridge exposes fixed bootstrap, receive, and native post capabilities without content logging or execution APIs", async () => {
  const source = await read("src/editor.ts");
  const runtime = await read("src/session.ts");

  assert.equal(source.match(/createNativePostMessage\(bridgeWindow\.webkit\?\.messageHandlers\?\.notoBridge\)/g)?.length, 1);
  assert.equal(source.match(/bridgeWindow\.notoBridge\s*=/g)?.length, 1);
  assert.match(source, /Object\.freeze\(\{ bootstrap, receive \}\)/);
  assert.match(runtime, /bootstrap\(input: unknown\)/);
  assert.match(source, /bridgeState = "fatal"/);
  assert.match(source, /Native bridge unavailable/);
  assert.match(source, /editable\.of\(EditorView\.editable\.of\(false\)\)/);
  assert.match(source, /setEditable: \(isEditable\) => view\.dispatch/);
  assert.doesNotMatch(`${source}\n${runtime}`, /console\.|(?:filePath|filesystem|readFile|writeFile|exec|spawn|eval\s*\()/i);
  assert.doesNotMatch(runtime, /postMessage\([^)]*(?:text|dataBase64|markdown)/i);
});

test("session tests establish state through public behavior rather than mutating internals", async () => {
  const tests = await read("tests/session-runtime.test.mjs");
  assert.doesNotMatch(tests, /\.session\.(?:dirty|phase|revision|savedThroughRevision|lastSaveFailure)\s*=(?!=)/);
});

test("CodeMirror state preserves Markdown and applies edits without DOM reconstruction", () => {
  const markdown = "# Noto\n\nPlain **Markdown**.";
  const state = EditorState.create({ doc: markdown });
  const transaction = state.update({
    changes: { from: state.doc.length, insert: "\n" },
  });

  assert.equal(state.doc.toString(), markdown);
  assert.equal(transaction.state.doc.toString(), `${markdown}\n`);
});

test("the production document contains one CodeMirror mount and no preview surface", async () => {
  const [html, editor] = await Promise.all([read("src/index.html"), read("src/editor.ts")]);

  assert.equal(html.match(/id="editor"/g)?.length, 1);
  assert.doesNotMatch(html, /preview|rendered-pane|source-pane/i);
  assert.equal(editor.match(/new EditorView\(/g)?.length, 1);
  assert.doesNotMatch(editor, /innerHTML|outerHTML|DOMParser|serializeToString/);
  assert.doesNotMatch(
    editor,
    /(?:window|globalThis|bridgeWindow)\s*(?:\.\w+|\[[^\]]+\])?\s*=\s*view\b/,
  );
});

test("the production CodeMirror setup omits code-editor gutter and active-line chrome", async () => {
  const editor = await read("src/editor.ts");

  assert.match(editor, /import \{ minimalSetup \} from "codemirror"/);
  assert.match(editor, /const extensions = \[\s*minimalSetup,/);
  assert.doesNotMatch(editor, /\bbasicSetup\b/);
  assert.doesNotMatch(
    editor,
    /\b(?:lineNumbers|foldGutter|highlightActiveLine|highlightActiveLineGutter)\s*\(/,
  );
});

test("the WebEditor test command consumes the frozen shared protocol fixtures", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const sharedFixtures = join(root, "..", "Tests", "Fixtures", "BridgeProtocol", "v1");
  const fixtureNames = (await readdir(sharedFixtures)).sort();

  assert.match(packageJson.scripts.test, /\.\.\/Tests\/ProtocolContracts\/validate-fixtures\.mjs/);
  assert.deepEqual(fixtureNames, [
    "chunk-cases.json",
    "invalid-messages.json",
    "protocol.schema.json",
    "revision-cases.json",
    "state-transitions.json",
    "valid-messages.json",
  ]);

  const fixtureEntries = await Promise.all(fixtureNames.map(async (name) => [name, JSON.parse(await readFile(join(sharedFixtures, name), "utf8"))]));
  const fixtures = Object.fromEntries(fixtureEntries);
  const validMessages = fixtures["valid-messages.json"];
  const invalidMessages = fixtures["invalid-messages.json"];
  const revisionCases = fixtures["revision-cases.json"];

  assert.equal(fixtures["protocol.schema.json"].$defs.revision.maximum, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(fixtures["protocol.schema.json"].$defs.editorDelta.required, ["transactionId", "fromRevision", "toRevision", "utf8ByteLength", "sha256"]);
  assert.deepEqual(fixtures["state-transitions.json"].allowed.loading, ["ready", "saveFailed", "closed"]);
  assert.deepEqual(fixtures["state-transitions.json"].allowed.snapshotting, ["committing", "conflict", "saveFailed", "closed"]);
  assert.equal(validMessages.find((message) => message.type === "editor.delta").payload.text, undefined);
  assert(invalidMessages.some((fixture) => fixture.name === "delta-carries-inline-text"));
  assert.equal(invalidMessages.filter((fixture) => fixture.reason === "unsafeInteger").length, 5);
  assert(revisionCases.some((fixture) => fixture.name === "conflicting-length-duplicate" && fixture.expected === "rejectCheckpointRequired"));
  assert(revisionCases.some((fixture) => fixture.name === "conflicting-hash-duplicate" && fixture.expected === "rejectCheckpointRequired"));
  assert(revisionCases.some((fixture) => fixture.name === "saved-current-revision-is-clean" && fixture.expected === "acceptClean"));
  assert(revisionCases.some((fixture) => fixture.name === "saved-prior-revision-remains-dirty" && fixture.expected === "acceptDirty"));
});
