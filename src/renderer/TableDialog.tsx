/**
 * Typora's Insert Table: how many rows, how many columns, then the table.
 *
 * A table of a known size is what a note usually starts with, and inserting
 * two by three and adding columns by hand is slower than saying four. Two
 * number fields, Enter inserts, Escape leaves. The rows are the body's; the
 * header row is always there, since a markdown table has one.
 */

import { useEffect, useRef, useState } from 'react';

export interface TableDialogProps {
  readonly onInsert: (rows: number, columns: number) => void;
  readonly onClose: () => void;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function TableDialog({ onInsert, onClose }: TableDialogProps) {
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(3);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => { first.current?.focus(); first.current?.select(); }, []);

  // Escape closes it wherever the focus is. A handler on the form alone was
  // deaf for the moment between the panel appearing and the field taking the
  // caret, and a key pressed in that moment did nothing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const submit = () => onInsert(clamp(rows, 1, 100), clamp(columns, 1, 30));

  return (
    <div className="table-dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form
        className="table-dialog"
        role="dialog"
        aria-label="Insert table"
        data-testid="table-dialog"
        onSubmit={(event) => { event.preventDefault(); submit(); }}
      >
        <h2 className="table-dialog-title">Insert table</h2>
        <label className="table-dialog-field">
          <span>Rows</span>
          <input ref={first} type="number" min={1} max={100} value={rows} data-testid="table-rows"
            onChange={(event) => setRows(Number(event.target.value) || 1)} />
        </label>
        <label className="table-dialog-field">
          <span>Columns</span>
          <input type="number" min={1} max={30} value={columns} data-testid="table-columns"
            onChange={(event) => setColumns(Number(event.target.value) || 1)} />
        </label>
        <div className="table-dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="is-primary" data-testid="table-insert">Insert</button>
        </div>
      </form>
    </div>
  );
}
