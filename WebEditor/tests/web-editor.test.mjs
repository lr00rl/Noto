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
  assert.match(html, /style-src 'self' 'nonce-noto-web-editor'/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /unsafe-(?:inline|eval)/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(html, /\sstyle=/i);
});

test("CodeMirror receives the same nonce allowed by the CSP", async () => {
  const [html, editor] = await Promise.all([read("src/index.html"), read("src/editor.ts")]);
  const nonce = html.match(/style-src 'self' 'nonce-([^']+)'/)?.[1];

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

test("CodeMirror state preserves Markdown and applies edits without DOM reconstruction", () => {
  const markdown = "# Noto\n\nPlain **Markdown**.";
  const state = EditorState.create({ doc: markdown });
  const transaction = state.update({
    changes: { from: state.doc.length, insert: "\n" },
  });

  assert.equal(state.doc.toString(), markdown);
  assert.equal(transaction.state.doc.toString(), `${markdown}\n`);
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
