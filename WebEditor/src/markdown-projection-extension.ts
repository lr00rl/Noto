import { syntaxTree } from "@codemirror/language";
import {
  RangeSet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
} from "@codemirror/view";
import {
  describeMarkdownProjection,
  type MarkdownProjectionSnapshot,
  type ProjectionDescriptor,
} from "./markdown-projection.ts";

interface ProjectionFieldValue {
  readonly snapshot: MarkdownProjectionSnapshot;
  readonly decorations: DecorationSet;
  readonly atomicRanges: RangeSet<Decoration>;
  readonly composing: boolean;
}

const setComposing = StateEffect.define<boolean>();

const cssRole = (role: string) => role.replaceAll(/[^a-z0-9-]/gi, "-");

const unitAttributes = (descriptor: ProjectionDescriptor) => ({
  "data-noto-unit-id": descriptor.id,
  "data-noto-kind": descriptor.kind,
  "data-noto-activity": descriptor.activity,
});

const forEachTextSegment = (
  state: EditorState,
  from: number,
  to: number,
  visit: (from: number, to: number) => void,
): void => {
  if (from >= to) return;
  let line = state.doc.lineAt(from);
  while (line.from <= to) {
    const segmentFrom = Math.max(from, line.from);
    const segmentTo = Math.min(to, line.to);
    if (segmentFrom < segmentTo) visit(segmentFrom, segmentTo);
    if (line.to >= to || line.number >= state.doc.lines) break;
    line = state.doc.line(line.number + 1);
  }
};

const lineClasses = (descriptor: ProjectionDescriptor): readonly string[] => {
  const classes = descriptor.roles.map((role) => `noto-line-${cssRole(role)}`);
  if (descriptor.activity !== "inactive") classes.push("noto-line-active");
  return classes;
};

const buildFieldValue = (state: EditorState, composing = false): ProjectionFieldValue => {
  const snapshot = describeMarkdownProjection(state);
  const decorationRanges: Range<Decoration>[] = [];
  const atomicRanges: Range<Decoration>[] = [];
  const lines = new Map<number, Set<string>>();

  for (const descriptor of snapshot.descriptors) {
    const attributes = unitAttributes(descriptor);
    const unitDecoration = Decoration.mark({
      class: `noto-unit noto-unit-${cssRole(descriptor.kind)}`,
      attributes,
    });
    forEachTextSegment(state, descriptor.from, descriptor.to, (from, to) => {
      decorationRanges.push(unitDecoration.range(from, to));
    });

    for (const contentRange of descriptor.contentRanges) {
      const contentDecoration = Decoration.mark({
        class: `noto-role noto-role-${cssRole(contentRange.role)}`,
        attributes: {
          ...attributes,
          "data-noto-role": contentRange.role,
        },
      });
      forEachTextSegment(state, contentRange.from, contentRange.to, (from, to) => {
        decorationRanges.push(contentDecoration.range(from, to));
      });
    }

    const markerState = descriptor.activity === "inactive" ? "concealed" : "revealed";
    for (const markerRange of descriptor.markerRanges) {
      if (markerRange.from >= markerRange.to) continue;
      const markerDecoration = Decoration.mark({
        class: `noto-md-marker noto-md-marker-${markerState}`,
        attributes: {
          ...attributes,
          "data-noto-marker": markerRange.role,
          "data-noto-marker-state": markerState,
        },
      });
      decorationRanges.push(markerDecoration.range(markerRange.from, markerRange.to));
      if (markerState === "concealed") {
        atomicRanges.push(markerDecoration.range(markerRange.from, markerRange.to));
      }
    }

    let line = state.doc.lineAt(descriptor.from);
    const lastLine = state.doc.lineAt(Math.max(descriptor.from, descriptor.to - 1));
    const classes = lineClasses(descriptor);
    while (line.number <= lastLine.number) {
      const entry = lines.get(line.from) ?? new Set<string>();
      for (const className of classes) entry.add(className);
      lines.set(line.from, entry);
      if (line.number === lastLine.number) break;
      line = state.doc.line(line.number + 1);
    }
  }

  for (const [position, classes] of lines) {
    decorationRanges.push(
      Decoration.line({
        attributes: { class: [...classes].sort().join(" ") },
      }).range(position),
    );
  }

  return {
    snapshot,
    decorations: Decoration.set(decorationRanges, true),
    atomicRanges: RangeSet.of(atomicRanges, true),
    composing,
  };
};

const projectionField = StateField.define<ProjectionFieldValue>({
  create: (state) => buildFieldValue(state),
  update: (value, transaction) => {
    let composing = value.composing;
    for (const effect of transaction.effects) {
      if (effect.is(setComposing)) composing = effect.value;
    }

    if (composing) {
      return {
        ...value,
        decorations: value.decorations.map(transaction.changes),
        atomicRanges: value.atomicRanges.map(transaction.changes),
        composing,
      };
    }

    if (
      value.composing ||
      transaction.docChanged ||
      transaction.selection !== undefined ||
      syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
    ) {
      return buildFieldValue(transaction.state);
    }
    return value;
  },
});

const compositionGuard = ViewPlugin.define(
  () => ({}),
  {
    eventHandlers: {
      compositionstart: (_event, view) => {
        view.dispatch({ effects: setComposing.of(true) });
      },
      compositionend: (_event, view) => {
        view.dispatch({ effects: setComposing.of(false) });
      },
    },
  },
);

export const markdownProjection = (): Extension => [
  projectionField,
  EditorView.decorations.from(projectionField, (value) => value.decorations),
  EditorView.atomicRanges.of((view) => view.state.field(projectionField).atomicRanges),
  compositionGuard,
];
