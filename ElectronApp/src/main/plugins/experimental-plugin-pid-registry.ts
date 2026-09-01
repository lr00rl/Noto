export type ExperimentalPluginPidCollision = 'editor' | 'plugin';

export class ExperimentalPluginPidRegistry {
  readonly #live = new Map<string, number>();
  readonly #editorPid: () => number | null;

  constructor(editorPid: () => number | null) {
    this.#editorPid = editorPid;
  }

  register(runtimeKey: string, pid: number): { ok: true } | { ok: false; collision: ExperimentalPluginPidCollision } {
    const editorPid = this.#editorPid();
    if (editorPid !== null && pid === editorPid) return { ok: false, collision: 'editor' };
    for (const [key, livePid] of this.#live) {
      if (key !== runtimeKey && livePid === pid) return { ok: false, collision: 'plugin' };
    }
    this.#live.set(runtimeKey, pid);
    return { ok: true };
  }

  release(runtimeKey: string): void {
    this.#live.delete(runtimeKey);
  }

  entries(): ReadonlyArray<{ runtimeKey: string; pid: number }> {
    return [...this.#live].map(([runtimeKey, pid]) => ({ runtimeKey, pid }));
  }
}

