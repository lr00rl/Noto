import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { EditorSelection, EditorState } from "@codemirror/state";

export type ProjectionKind =
  | "paragraph"
  | "hardBreak"
  | "heading"
  | "emphasis"
  | "strong"
  | "inlineCode"
  | "link"
  | "listItem"
  | "blockQuote"
  | "thematicBreak"
  | "fencedCode";

export type ProjectionActivity = "inactive" | "active" | "touched";

export interface ProjectionRange {
  readonly from: number;
  readonly to: number;
  readonly role: string;
}

export interface ProjectionDescriptor {
  readonly id: string;
  readonly kind: ProjectionKind;
  readonly from: number;
  readonly to: number;
  readonly depth: number;
  readonly markerRanges: readonly ProjectionRange[];
  readonly contentRanges: readonly ProjectionRange[];
  readonly roles: readonly string[];
  readonly activity: ProjectionActivity;
}

export interface MarkdownProjectionSnapshot {
  readonly sourceLength: number;
  readonly treeComplete: boolean;
  readonly descriptors: readonly ProjectionDescriptor[];
}

interface ParsedNode {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly depth: number;
  readonly parent: number | null;
  readonly children: number[];
}

type MarkdownCursor = ReturnType<ReturnType<typeof syntaxTree>["cursor"]>;

const unsupportedNodeNames = new Set([
  "Autolink",
  "HTMLBlock",
  "HTMLTag",
  "Image",
  "SetextHeading1",
  "SetextHeading2",
  "Strikethrough",
  "Table",
  "Task",
]);

const descriptor = (
  kind: ProjectionKind,
  node: ParsedNode,
  roles: readonly string[],
  markerRanges: readonly ProjectionRange[] = [],
  contentRanges: readonly ProjectionRange[] = [],
): ProjectionDescriptor => ({
  id: `${kind}:${node.from}-${node.to}`,
  kind,
  from: node.from,
  to: node.to,
  depth: node.depth,
  markerRanges,
  contentRanges,
  roles,
  activity: "inactive",
});

const range = (from: number, to: number, role: string): ProjectionRange => ({
  from,
  to,
  role,
});

const collectNodes = (cursor: MarkdownCursor): ParsedNode[] => {
  const nodes: ParsedNode[] = [];

  const visit = (parent: number | null, depth: number): void => {
    const index = nodes.length;
    nodes.push({
      name: cursor.name,
      from: cursor.from,
      to: cursor.to,
      depth,
      parent,
      children: [],
    });
    if (parent !== null) nodes[parent]?.children.push(index);

    if (cursor.firstChild()) {
      do visit(index, depth + 1);
      while (cursor.nextSibling());
      cursor.parent();
    }
  };

  visit(null, 0);
  return nodes;
};

const childNodes = (nodes: readonly ParsedNode[], node: ParsedNode, name?: string) =>
  node.children
    .map((index) => nodes[index])
    .filter(
      (child): child is ParsedNode =>
        child !== undefined && (name === undefined || child.name === name),
    );

const descendantNodes = (
  nodes: readonly ParsedNode[],
  node: ParsedNode,
  name: string,
): ParsedNode[] => {
  const descendants: ParsedNode[] = [];
  const visit = (candidate: ParsedNode): void => {
    for (const child of childNodes(nodes, candidate)) {
      if (child.name === name) descendants.push(child);
      visit(child);
    }
  };
  visit(node);
  return descendants;
};

const nearestAncestor = (
  nodes: readonly ParsedNode[],
  node: ParsedNode,
  name: string,
): ParsedNode | undefined => {
  let parentIndex = node.parent;
  while (parentIndex !== null) {
    const parent = nodes[parentIndex];
    if (parent === undefined) return undefined;
    if (parent.name === name) return parent;
    parentIndex = parent.parent;
  }
  return undefined;
};

const rangesOverlap = (
  left: Pick<ProjectionRange, "from" | "to">,
  right: Pick<ProjectionRange, "from" | "to">,
) => left.from < right.to && right.from < left.to;

const blockedRanges = (nodes: readonly ParsedNode[], source: string): ProjectionRange[] => {
  const blocked: ProjectionRange[] = [];
  for (const node of nodes) {
    if (!unsupportedNodeNames.has(node.name)) continue;
    const blockedNode =
      node.name === "Task" ? nearestAncestor(nodes, node, "ListItem") ?? node : node;
    blocked.push(range(blockedNode.from, blockedNode.to, "fallback-source"));
  }

  for (const node of nodes) {
    if (node.name !== "ListItem") continue;
    const mark = childNodes(nodes, node, "ListMark")[0];
    const paragraph = childNodes(nodes, node, "Paragraph")[0];
    if (mark === undefined || paragraph === undefined) continue;
    const prefix = source.slice(paragraph.from, Math.min(paragraph.to, paragraph.from + 4));
    const taskMarker =
      prefix[0] === "[" &&
      (prefix[1] === " " || prefix[1] === "x" || prefix[1] === "X") &&
      prefix[2] === "]" &&
      (prefix.length === 3 || prefix[3] === " " || prefix[3] === "\t");
    if (taskMarker) blocked.push(range(node.from, node.to, "task-list-fallback"));
  }

  const document = nodes[0];
  if (document !== undefined) {
    const topLevel = childNodes(nodes, document);
    const opening = topLevel[0];
    const bodyAndClose = topLevel[1];
    if (
      opening?.name === "HorizontalRule" &&
      opening.from === 0 &&
      source.slice(opening.from, opening.to) === "---" &&
      (bodyAndClose?.name === "SetextHeading1" || bodyAndClose?.name === "SetextHeading2")
    ) {
      blocked.push(range(opening.from, bodyAndClose.to, "front-matter-fallback"));
    }
  }
  return blocked;
};

const isBlocked = (node: ParsedNode, blocked: readonly ProjectionRange[]) =>
  blocked.some((blockedRange) => rangesOverlap(node, blockedRange));

const horizontalWhitespaceAfter = (source: string, position: number, limit: number) => {
  let end = position;
  while (end < limit && (source[end] === " " || source[end] === "\t")) end += 1;
  return end;
};

const horizontalWhitespaceBefore = (source: string, position: number, limit: number) => {
  let start = position;
  while (start > limit && (source[start - 1] === " " || source[start - 1] === "\t")) {
    start -= 1;
  }
  return start;
};

const describeNode = (
  state: EditorState,
  nodes: readonly ParsedNode[],
  node: ParsedNode,
): ProjectionDescriptor | undefined => {
  const source = state.doc.toString();

  if (node.name === "Paragraph") {
    return descriptor(
      "paragraph",
      node,
      ["prose"],
      [],
      [range(node.from, node.to, "prose")],
    );
  }

  if (node.name === "HardBreak") {
    const line = state.doc.lineAt(node.from);
    const markerTo = Math.min(node.to, line.to);
    if (markerTo <= node.from) return undefined;
    return descriptor(
      "hardBreak",
      node,
      ["hard-break"],
      [range(node.from, markerTo, "hard-break")],
    );
  }

  const headingMatch = /^ATXHeading([1-6])$/.exec(node.name);
  if (headingMatch !== null) {
    const level = Number(headingMatch[1]);
    const marks = childNodes(nodes, node, "HeaderMark");
    const first = marks[0];
    if (first === undefined) return undefined;
    const markers: ProjectionRange[] = [
      range(
        first.from,
        horizontalWhitespaceAfter(source, first.to, node.to),
        "heading-prefix",
      ),
    ];
    const last = marks.at(-1);
    if (last !== undefined && last !== first) {
      markers.push(
        range(
          horizontalWhitespaceBefore(source, last.from, markers[0]?.to ?? first.to),
          last.to,
          "heading-suffix",
        ),
      );
    }
    const contentFrom = markers[0]?.to ?? first.to;
    const contentTo = markers[1]?.from ?? node.to;
    return descriptor(
      "heading",
      node,
      ["heading", `heading-${level}`],
      markers,
      [range(contentFrom, Math.max(contentFrom, contentTo), "heading-content")],
    );
  }

  if (node.name === "Emphasis" || node.name === "StrongEmphasis") {
    const marks = childNodes(nodes, node, "EmphasisMark");
    const first = marks[0];
    const last = marks.at(-1);
    if (first === undefined || last === undefined || first === last) return undefined;
    const strong = node.name === "StrongEmphasis";
    return descriptor(
      strong ? "strong" : "emphasis",
      node,
      [strong ? "strong" : "emphasis"],
      [
        range(first.from, first.to, strong ? "strong-open" : "emphasis-open"),
        range(last.from, last.to, strong ? "strong-close" : "emphasis-close"),
      ],
      [range(first.to, last.from, strong ? "strong-content" : "emphasis-content")],
    );
  }

  if (node.name === "InlineCode") {
    const marks = childNodes(nodes, node, "CodeMark");
    const first = marks[0];
    const last = marks.at(-1);
    if (first === undefined || last === undefined || first === last) return undefined;
    return descriptor(
      "inlineCode",
      node,
      ["inline-code"],
      [range(first.from, first.to, "code-open"), range(last.from, last.to, "code-close")],
      [range(first.to, last.from, "inline-code-content")],
    );
  }

  if (node.name === "Link") {
    const marks = childNodes(nodes, node, "LinkMark");
    const [openLabel, closeLabel, openTarget] = marks;
    const closeTarget = marks.at(-1);
    if (
      marks.length < 4 ||
      openLabel === undefined ||
      closeLabel === undefined ||
      openTarget === undefined ||
      closeTarget === undefined ||
      source.slice(openLabel.from, openLabel.to) !== "[" ||
      source.slice(closeLabel.from, closeLabel.to) !== "]" ||
      source.slice(openTarget.from, openTarget.to) !== "(" ||
      source.slice(closeTarget.from, closeTarget.to) !== ")"
    ) {
      return undefined;
    }
    return descriptor(
      "link",
      node,
      ["link"],
      [
        range(openLabel.from, openLabel.to, "link-open"),
        range(closeLabel.from, node.to, "link-target"),
      ],
      [range(openLabel.to, closeLabel.from, "link-label")],
    );
  }

  if (node.name === "ListItem") {
    const parent = node.parent === null ? undefined : nodes[node.parent];
    const mark = childNodes(nodes, node, "ListMark")[0];
    if (
      mark === undefined ||
      (parent?.name !== "BulletList" && parent?.name !== "OrderedList")
    ) {
      return undefined;
    }
    if (parent.name === "BulletList") {
      return descriptor(
        "listItem",
        node,
        ["list-item", "bullet-list-item"],
        [range(mark.from, mark.to, "bullet-marker")],
        [range(mark.to, node.to, "list-item-content")],
      );
    }
    const delimiterFrom = Math.max(mark.from, mark.to - 1);
    return descriptor(
      "listItem",
      node,
      ["list-item", "ordered-list-item"],
      [range(delimiterFrom, mark.to, "ordered-delimiter")],
      [
        range(mark.from, delimiterFrom, "list-ordinal"),
        range(mark.to, node.to, "list-item-content"),
      ],
    );
  }

  if (node.name === "Blockquote") {
    const markers = descendantNodes(nodes, node, "QuoteMark").map((mark) =>
      range(
        mark.from,
        horizontalWhitespaceAfter(source, mark.to, Math.min(node.to, mark.to + 1)),
        "quote-prefix",
      ),
    );
    if (markers.length === 0) return undefined;
    return descriptor(
      "blockQuote",
      node,
      ["block-quote"],
      markers,
      [range(node.from, node.to, "quote-content")],
    );
  }

  if (node.name === "HorizontalRule") {
    return descriptor(
      "thematicBreak",
      node,
      ["thematic-break"],
      [range(node.from, node.to, "thematic-break")],
    );
  }

  if (node.name === "FencedCode") {
    const marks = childNodes(nodes, node, "CodeMark");
    const first = marks[0];
    const last = marks.at(-1);
    if (first === undefined || last === undefined || first === last) return undefined;
    const info = childNodes(nodes, node, "CodeInfo")[0];
    const openingTo = info?.to ?? first.to;
    return descriptor(
      "fencedCode",
      node,
      ["fenced-code"],
      [
        range(first.from, openingTo, "code-fence-open"),
        range(last.from, last.to, "code-fence-close"),
      ],
      [range(openingTo, last.from, "fenced-code-content")],
    );
  }

  return undefined;
};

const activationTier = (kind: ProjectionKind) => {
  switch (kind) {
    case "emphasis":
    case "strong":
    case "inlineCode":
    case "link":
    case "hardBreak":
      return 0;
    case "heading":
    case "listItem":
    case "thematicBreak":
    case "fencedCode":
      return 1;
    case "blockQuote":
      return 2;
    case "paragraph":
      return 3;
  }
};

const compareActivation = (left: ProjectionDescriptor, right: ProjectionDescriptor) =>
  activationTier(left.kind) - activationTier(right.kind) ||
  left.to - left.from - (right.to - right.from) ||
  right.depth - left.depth ||
  left.from - right.from;

const containsPosition = (candidate: ProjectionDescriptor, position: number) =>
  candidate.from <= position && position <= candidate.to;

const containsSelection = (
  candidate: ProjectionDescriptor,
  selectionFrom: number,
  selectionTo: number,
) => candidate.from <= selectionFrom && selectionTo <= candidate.to;

const touchesSelection = (
  candidate: ProjectionDescriptor,
  selectionFrom: number,
  selectionTo: number,
) => candidate.from <= selectionTo && selectionFrom <= candidate.to;

const applyActivity = (
  descriptors: readonly ProjectionDescriptor[],
  selection: EditorSelection,
): ProjectionDescriptor[] => {
  const main = selection.main;
  const selectionFrom = Math.min(main.anchor, main.head);
  const selectionTo = Math.max(main.anchor, main.head);

  if (main.empty) {
    const active = descriptors
      .filter((candidate) => containsPosition(candidate, main.head))
      .sort(compareActivation)[0];
    return descriptors.map((candidate) => ({
      ...candidate,
      activity: candidate.id === active?.id ? "active" : "inactive",
    }));
  }

  const active = descriptors
    .filter((candidate) => containsSelection(candidate, selectionFrom, selectionTo))
    .sort(compareActivation)[0];
  const touchedMarkerUnits = new Set(
    descriptors
      .filter(
        (candidate) =>
          candidate.markerRanges.length > 0 &&
          candidate.id !== active?.id &&
          touchesSelection(candidate, selectionFrom, selectionTo) &&
          (active === undefined || containsSelection(active, candidate.from, candidate.to)),
      )
      .map((candidate) => candidate.id),
  );

  return descriptors.map((candidate) => ({
    ...candidate,
    activity:
      candidate.id === active?.id
        ? "active"
        : touchedMarkerUnits.has(candidate.id)
          ? "touched"
          : "inactive",
  }));
};

export const describeMarkdownProjection = (state: EditorState): MarkdownProjectionSnapshot => {
  const treeComplete = syntaxTreeAvailable(state, state.doc.length);
  if (!treeComplete) {
    return { sourceLength: state.doc.length, treeComplete, descriptors: [] };
  }

  const nodes = collectNodes(syntaxTree(state).cursor());
  const blocked = blockedRanges(nodes, state.doc.toString());
  const descriptors = nodes
    .filter((node) => !isBlocked(node, blocked))
    .map((node) => describeNode(state, nodes, node))
    .filter((value): value is ProjectionDescriptor => value !== undefined)
    .sort(
      (left, right) => left.from - right.from || right.to - left.to || left.depth - right.depth,
    );

  return {
    sourceLength: state.doc.length,
    treeComplete,
    descriptors: applyActivity(descriptors, state.selection),
  };
};
