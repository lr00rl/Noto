/**
 * The vault's graph, for the note in front: what links here, what it
 * links to, and what it is probably about the same thing as.
 *
 * The author's note-assistant builds this graph and their Typora plugin
 * shows it in a panel. Here it is a view of the rail, next to the files
 * and the outline, so a note's neighbours are a click away while it is
 * being read. The lists come from main, which reads the graph; nothing is
 * computed here, so this cannot disagree with the plugin.
 */

import { useEffect, useState } from 'react';
import type { WorkspaceLinkV1, WorkspaceLinksReplyV1 } from '../shared/workspace/v1/contracts';

export interface RailLinksProps {
  readonly currentPath: string | null;
  readonly onLinks: (path: string) => Promise<WorkspaceLinksReplyV1 | null>;
  readonly onOpen: (path: string) => void;
}

function Section({ title, items, onOpen, testId }: {
  title: string;
  items: readonly WorkspaceLinkV1[];
  onOpen: (path: string) => void;
  testId: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="rail-links-section" data-testid={testId}>
      <h3 className="rail-links-kicker">{title} <span className="rail-links-count">{items.length}</span></h3>
      {items.map((item) => {
        const folder = item.relativePath.slice(0, Math.max(0, item.relativePath.lastIndexOf('/')));
        return (
          <button type="button" key={item.path} className="rail-hit-file rail-link" title={item.relativePath}
            data-testid="rail-link" onClick={() => onOpen(item.path)}>
            <span className="rail-hit-name">{item.title}</span>
            {folder.length > 0 && <span className="rail-hit-folder">{folder}</span>}
          </button>
        );
      })}
    </section>
  );
}

export function RailLinks({ currentPath, onLinks, onOpen }: RailLinksProps) {
  const [reply, setReply] = useState<WorkspaceLinksReplyV1 | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (currentPath === null) { setReply(null); return; }
    let live = true;
    setLoading(true);
    void onLinks(currentPath).then((found) => {
      if (!live) return;
      setReply(found);
      setLoading(false);
    });
    return () => { live = false; };
  }, [currentPath, onLinks]);

  if (currentPath === null) return <p className="rail-empty">Open a note to see what it is linked to.</p>;
  if (loading && reply === null) return <p className="rail-empty">Reading the graph…</p>;
  if (reply === null || !reply.available) {
    return (
      <p className="rail-empty" data-testid="links-status">
        This vault has no note-assistant graph. It is written to <code>.note-assistant/graph.json</code> by the vault's own tools.
      </p>
    );
  }
  if (!reply.known) {
    return <p className="rail-empty" data-testid="links-status">The graph has not met this note yet.</p>;
  }
  const nothing = reply.backlinks.length + reply.links.length + reply.related.length === 0;
  return (
    <div className="rail-links" data-testid="links-panel">
      {nothing && <p className="rail-empty" data-testid="links-status">Nothing links here yet, and nothing is near.</p>}
      <Section title="Linked from" items={reply.backlinks} onOpen={onOpen} testId="links-backlinks" />
      <Section title="Links to" items={reply.links} onOpen={onOpen} testId="links-out" />
      <Section title="Related" items={reply.related} onOpen={onOpen} testId="links-related" />
    </div>
  );
}
