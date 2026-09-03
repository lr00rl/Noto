/**
 * Noticing that a file changed underneath an open document.
 *
 * The obvious implementation does not work, and the way it fails is quiet,
 * which is why this is a class of its own with no Electron import and a test
 * beside it. `fs.watch` on a path holds the file, not the name. Every save this
 * app performs replaces the file by renaming a new one over it, so the watcher
 * is left holding a file nothing points at any more and never fires again. It
 * does not error, it does not close, it simply stops. Probed on this machine
 * with Node 22 on macOS: an in-place write reports `change`, and a rename over
 * the path reports `rename` once and then silence forever.
 *
 * So a `rename` is not an event to report, it is an instruction to re-arm. The
 * file usually exists again within a millisecond or two, but not always at the
 * moment the event arrives, so the re-arm retries on a doubling delay before
 * giving up and falling back to polling. Polling is also where a watcher that
 * errors ends up: a network share can arm successfully and never fire, and a
 * reader on one deserves the slow answer rather than no answer.
 *
 * Reports are debounced. A writer that streams a file produces a burst of
 * events for one logical change, and reading the file between two of its writes
 * gives half a document. The ceiling stops a continuous writer from starving
 * the report forever.
 */

import { watch, watchFile, unwatchFile, type FSWatcher } from 'node:fs';

/** Delays for re-arming after a rename, before falling back to polling. */
const REARM_LADDER = [0, 50, 150, 350, 750] as const;
const SETTLE_MS = 300;
const CEILING_MS = 2_000;
const POLL_INTERVAL_MS = 2_000;

export interface DocumentWatcherOptions {
  /** Something changed, after the burst settled. Never called for our own writes. */
  readonly onChanged: () => void;
  readonly onDiagnostic?: (event: string, detail: Record<string, unknown>) => void;
  /** Injected so a test does not have to wait in real time. */
  readonly now?: () => number;
}

export class DocumentWatcher {
  private watcher: FSWatcher | null = null;

  private polling: string | null = null;

  private settleTimer: NodeJS.Timeout | null = null;

  private ceilingAt = 0;

  private rearmTimer: NodeJS.Timeout | null = null;

  private path: string | null = null;

  private generation = 0;

  private readonly now: () => number;

  constructor(private readonly options: DocumentWatcherOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Watch `filePath`, dropping whatever was being watched before. */
  arm(filePath: string): void {
    this.close();
    this.path = filePath;
    this.generation += 1;
    this.start(this.generation);
  }

  /**
   * Say that this process is about to replace the file.
   *
   * The watcher is closed rather than muted, because the file it holds is the
   * one being replaced and would go deaf anyway. `rearm` puts it back.
   */
  suspend(): void {
    this.closeHandles();
  }

  /** Watch the file again after this process replaced it. */
  rearm(): void {
    if (!this.path) return;
    this.generation += 1;
    this.start(this.generation);
  }

  close(): void {
    this.generation += 1;
    this.closeHandles();
    this.path = null;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.ceilingAt = 0;
  }

  /** Whether a real watcher is armed, as opposed to polling or nothing. */
  get watching(): boolean {
    return this.watcher !== null || this.polling !== null;
  }

  private closeHandles(): void {
    if (this.rearmTimer) clearTimeout(this.rearmTimer);
    this.rearmTimer = null;
    this.watcher?.close();
    this.watcher = null;
    if (this.polling) unwatchFile(this.polling);
    this.polling = null;
  }

  private start(generation: number, attempt = 0): void {
    const filePath = this.path;
    if (!filePath || generation !== this.generation) return;
    try {
      const watcher = watch(filePath, { persistent: false }, (kind) => {
        if (generation !== this.generation) return;
        if (kind === 'rename') {
          // The name now points at a different file, or at none. Whatever this
          // watcher is holding is no longer the document, so re-arm on the
          // path and let the check that follows decide what happened.
          this.closeHandles();
          this.schedule();
          this.rearmTimer = setTimeout(() => this.start(generation, 1), REARM_LADDER[1]);
          return;
        }
        this.schedule();
      });
      watcher.on('error', (error) => {
        if (generation !== this.generation) return;
        this.options.onDiagnostic?.('file_truth_watcher_failed', {
          code: (error as NodeJS.ErrnoException).code ?? 'WATCH_FAILED',
        });
        this.closeHandles();
        this.startPolling(generation);
      });
      this.watcher = watcher;
    } catch (error) {
      // The file is not there yet, which is ordinary in the middle of somebody
      // else's atomic save. Try again a few times before settling for polling.
      const next = REARM_LADDER[attempt + 1];
      if (next === undefined) {
        this.options.onDiagnostic?.('file_truth_watcher_polling', {
          code: (error as NodeJS.ErrnoException).code ?? 'WATCH_FAILED',
        });
        this.startPolling(generation);
        return;
      }
      this.rearmTimer = setTimeout(() => this.start(generation, attempt + 1), next);
    }
  }

  private startPolling(generation: number): void {
    const filePath = this.path;
    if (!filePath || generation !== this.generation) return;
    this.polling = filePath;
    watchFile(filePath, { interval: POLL_INTERVAL_MS, persistent: false }, () => {
      if (generation !== this.generation) return;
      this.schedule();
    });
  }

  /**
   * Report once the burst settles, and at the ceiling regardless.
   *
   * A file being written continuously would otherwise push the report back
   * forever and the reader would never be told anything changed.
   */
  private schedule(): void {
    const now = this.now();
    if (this.ceilingAt === 0) this.ceilingAt = now + CEILING_MS;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    const wait = Math.max(0, Math.min(SETTLE_MS, this.ceilingAt - now));
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.ceilingAt = 0;
      this.options.onChanged();
    }, wait);
  }
}
