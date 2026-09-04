/**
 * What the vault's own graph knows about a note.
 *
 * The author's note-assistant keeps `.note-assistant/graph.json` at the
 * vault's root: for every note, the notes it links to, the notes that link
 * to it, and the notes it is probably about the same thing as, scored. Its
 * Typora plugin shows these in a panel; this reads the same file so the
 * panel's substance is here too, from the same source, with nothing
 * computed twice and nothing that could disagree with it.
 *
 * The file is large, seventeen megabytes for this vault, so it is read once
 * and kept until its modification time changes. Only the note asked about
 * is sent to the renderer.
 */

import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

/** Where note-assistant writes its graph, under the vault root. */
export const GRAPH_RELATIVE_PATH = path.join('.note-assistant', 'graph.json');

/** How many related notes are worth showing; the scores fall off fast. */
export const MAX_RELATED = 20;

interface GraphRelated {
  readonly relPath: string;
  readonly title?: string;
  readonly score?: number;
}

interface GraphNote {
  readonly relPath: string;
  readonly title?: string;
  readonly explicitLinks?: readonly string[];
  readonly backlinks?: readonly string[];
  readonly candidates?: readonly GraphRelated[];
  readonly related?: readonly GraphRelated[];
}

export interface NoteGraph {
  readonly generatedAt: string | null;
  readonly notes: ReadonlyMap<string, GraphNote>;
}

export interface GraphLink {
  readonly relativePath: string;
  readonly title: string;
}

export interface NoteLinks {
  /** Notes that link here. */
  readonly backlinks: readonly GraphLink[];
  /** Notes this one links to. */
  readonly links: readonly GraphLink[];
  /** Notes the graph scores as being about the same thing, best first. */
  readonly related: readonly GraphLink[];
}

/** The graph as the file holds it, or null when the file is not a graph. */
export function parseGraph(text: string): NoteGraph | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const file = parsed as { generatedAt?: unknown; notes?: unknown };
  if (!Array.isArray(file.notes)) return null;
  const notes = new Map<string, GraphNote>();
  for (const note of file.notes) {
    if (typeof note === 'object' && note !== null && typeof (note as GraphNote).relPath === 'string') {
      notes.set((note as GraphNote).relPath, note as GraphNote);
    }
  }
  return { generatedAt: typeof file.generatedAt === 'string' ? file.generatedAt : null, notes };
}

const titleOf = (graph: NoteGraph, relPath: string, fallback?: string): string => {
  const known = graph.notes.get(relPath)?.title;
  if (known) return known;
  if (fallback) return fallback;
  const base = path.posix.basename(relPath);
  return base.replace(/\.md$/i, '');
};

/** The three lists for one note, or null when the graph has not met it. */
export function linksFor(graph: NoteGraph, relPath: string): NoteLinks | null {
  const note = graph.notes.get(relPath);
  if (!note) return null;
  const link = (target: string): GraphLink => ({ relativePath: target, title: titleOf(graph, target) });
  const links = (note.explicitLinks ?? []).map(link);
  const backlinks = (note.backlinks ?? []).map(link);
  // Related is what is not already linked either way: a note that links
  // here is a fact, not a suggestion, and is shown once, as the fact.
  const linked = new Set([...(note.explicitLinks ?? []), ...(note.backlinks ?? []), relPath]);
  const related = [...(note.related ?? note.candidates ?? [])]
    .filter((item) => typeof item.relPath === 'string' && !linked.has(item.relPath))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, MAX_RELATED)
    .map((item) => ({ relativePath: item.relPath, title: titleOf(graph, item.relPath, item.title) }));
  return { backlinks, links, related };
}

/**
 * The graph, read once per version of the file.
 *
 * The cache holds one graph, the open vault's; opening another vault reads
 * that one's graph and lets this go.
 */
export class GraphCache {
  private held: { file: string; mtimeMs: number; graph: NoteGraph | null } | null = null;

  constructor(private readonly read: (file: string) => Promise<string> = (file) => readFile(file, 'utf8')) {}

  /** Null when the vault has no graph, or the file is not one. */
  async graphFor(root: string): Promise<NoteGraph | null> {
    const file = path.join(root, GRAPH_RELATIVE_PATH);
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(file)).mtimeMs;
    } catch {
      this.held = null;
      return null;
    }
    if (this.held && this.held.file === file && this.held.mtimeMs === mtimeMs) return this.held.graph;
    let graph: NoteGraph | null;
    try {
      graph = parseGraph(await this.read(file));
    } catch {
      graph = null;
    }
    this.held = { file, mtimeMs, graph };
    return graph;
  }
}
