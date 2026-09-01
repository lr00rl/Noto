import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describeMarkdownProjection } from "../src/markdown-projection.ts";
import { markdownProjection } from "../src/markdown-projection-extension.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = JSON.parse(
  await readFile(join(root, "tests/fixtures/markdown-projection-golden.json"), "utf8"),
);

const makeState = (source, selection = { anchor: 0 }) =>
  EditorState.create({
    doc: source,
    selection,
    extensions: [markdown(), markdownProjection()],
  });

const findDescriptor = (descriptors, expected) =>
  descriptors.find(
    ({ kind, from, to }) =>
      kind === expected.kind && from === expected.from && to === expected.to,
  );

test("golden descriptors preserve exact source ranges and semantic roles", () => {
  for (const fixture of fixtures.cases) {
    const state = makeState(fixture.source);
    const before = state.doc.toString();
    const snapshot = describeMarkdownProjection(state);

    assert.equal(snapshot.sourceLength, fixture.source.length, fixture.name);
    assert.equal(state.doc.toString(), before, `${fixture.name}: descriptor changed source`);

    for (const expected of fixture.expected) {
      const descriptor = findDescriptor(snapshot.descriptors, expected);
      assert.ok(descriptor, `${fixture.name}: missing ${expected.kind} ${expected.from}-${expected.to}`);
      assert.deepEqual(descriptor.roles, expected.roles, `${fixture.name}: semantic roles`);
      assert.deepEqual(
        descriptor.markerRanges.map(({ from, to, role }) => [from, to, role]),
        expected.markers,
        `${fixture.name}: marker ranges`,
      );
      for (const marker of descriptor.markerRanges) {
        assert.equal(
          fixture.source.slice(marker.from, marker.to),
          before.slice(marker.from, marker.to),
          `${fixture.name}: marker source identity`,
        );
      }
    }
  }
});

test("unknown and malformed Markdown stays literal with no claimed marker hiding", () => {
  for (const fixture of fixtures.fallbackCases) {
    const state = makeState(fixture.source);
    const snapshot = describeMarkdownProjection(state);
    const markerBearing = snapshot.descriptors.filter(
      ({ markerRanges }) => markerRanges.length > 0,
    );

    assert.equal(state.doc.toString(), fixture.source, fixture.name);
    for (const kind of fixture.forbiddenKinds) {
      assert.equal(
        markerBearing.some((descriptor) => descriptor.kind === kind),
        false,
        `${fixture.name}: ${kind} must remain fallback source`,
      );
    }
  }
});

test("the smallest supported active unit wins at start, middle, end, nested, and empty boundaries", () => {
  const cases = [
    { source: "*emphasis*", position: 0, expected: ["emphasis:0-10"] },
    { source: "*emphasis*", position: 5, expected: ["emphasis:0-10"] },
    { source: "*emphasis*", position: 10, expected: ["emphasis:0-10"] },
    { source: "**bold *inner* tail**", position: 9, expected: ["emphasis:7-14"] },
    { source: "# ", position: 1, expected: ["heading:0-2"] },
    { source: "[]()", position: 1, expected: ["link:0-4"] },
  ];

  for (const fixture of cases) {
    const snapshot = describeMarkdownProjection(makeState(fixture.source, { anchor: fixture.position }));
    const active = snapshot.descriptors
      .filter(({ activity }) => activity === "active")
      .map(({ id }) => id);
    assert.deepEqual(active, fixture.expected, `${fixture.source} at ${fixture.position}`);
  }
});

test("contained and marker-crossing selections reveal exact units without changing anchor or head", () => {
  const source = "*alpha* and **beta**";
  const selections = [
    { anchor: 0, head: 2, expected: ["emphasis:0-7"] },
    { anchor: 1, head: 6, expected: ["emphasis:0-7"] },
    { anchor: 7, head: 14, expected: ["emphasis:0-7", "strong:12-20"] },
    { anchor: 14, head: 7, expected: ["emphasis:0-7", "strong:12-20"] },
  ];

  for (const fixture of selections) {
    const state = makeState(source, fixture);
    const { anchor, head } = state.selection.main;
    const snapshot = describeMarkdownProjection(state);
    const revealed = snapshot.descriptors
      .filter(
        ({ activity, markerRanges }) =>
          activity !== "inactive" && markerRanges.length > 0,
      )
      .map(({ id }) => id)
      .sort();

    assert.deepEqual(revealed, fixture.expected.toSorted(), `${anchor}->${head}`);
    assert.equal(state.selection.main.anchor, anchor);
    assert.equal(state.selection.main.head, head);
    assert.equal(state.doc.toString(), source);
  }
});

test("a fenced code block is one active unit and reveals both fences together", () => {
  const source = "before\n\n```ts\nconst x = 1\n```\n\nafter";
  const state = makeState(source, { anchor: source.indexOf("const") + 2 });
  const snapshot = describeMarkdownProjection(state);
  const fence = snapshot.descriptors.find(({ kind }) => kind === "fencedCode");

  assert.ok(fence);
  assert.equal(fence.activity, "active");
  assert.deepEqual(
    fence.markerRanges.map(({ from, to, role }) => [from, to, role]),
    [
      [8, 13, "code-fence-open"],
      [26, 29, "code-fence-close"],
    ],
  );
  assert.equal(state.doc.toString(), source);
});

test("selection-only projection changes are reversible and preserve document and logical selection", () => {
  const source = "plain *emphasis* tail";
  const initial = makeState(source, { anchor: 0 });
  const inside = initial.update({ selection: EditorSelection.cursor(9) }).state;
  const outside = inside.update({ selection: EditorSelection.cursor(0) }).state;

  const insideEmphasis = describeMarkdownProjection(inside).descriptors.find(
    ({ kind }) => kind === "emphasis",
  );
  const outsideEmphasis = describeMarkdownProjection(outside).descriptors.find(
    ({ kind }) => kind === "emphasis",
  );

  assert.equal(insideEmphasis?.activity, "active");
  assert.equal(outsideEmphasis?.activity, "inactive");
  assert.equal(initial.doc.toString(), source);
  assert.equal(inside.doc.toString(), source);
  assert.equal(outside.doc.toString(), source);
  assert.deepEqual([inside.selection.main.anchor, inside.selection.main.head], [9, 9]);
  assert.deepEqual([outside.selection.main.anchor, outside.selection.main.head], [0, 0]);
});
