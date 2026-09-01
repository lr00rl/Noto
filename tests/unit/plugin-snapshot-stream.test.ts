import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { PluginLifecycleSnapshot } from '../../src/shared/plugins/lifecycle';
import { createPluginSnapshotStream } from '../../src/renderer/plugins/plugin-snapshot-stream';

const snapshots = (id: string) => [{ id }] as PluginLifecycleSnapshot[];

describe('plugin snapshot stream', () => {
  it('accepts bootstrap once when no push has arrived', () => {
    const publish = vi.fn();
    const stream = createPluginSnapshotStream(publish);

    expect(stream.bootstrap(snapshots('bootstrap'))).toBe(true);
    expect(stream.bootstrap(snapshots('stale-bootstrap'))).toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith(snapshots('bootstrap'));
  });

  it('ignores a stale bootstrap reply after a push', () => {
    const publish = vi.fn();
    const stream = createPluginSnapshotStream(publish);

    expect(stream.push(snapshots('new-push'))).toBe(true);
    expect(stream.bootstrap(snapshots('old-bootstrap'))).toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith(snapshots('new-push'));
  });

  it('adopts every push in arrival order', () => {
    const accepted: string[] = [];
    const stream = createPluginSnapshotStream((value) => accepted.push(value[0]!.id));

    stream.push(snapshots('push-1'));
    stream.push(snapshots('push-2'));
    stream.push(snapshots('push-3'));

    expect(accepted).toEqual(['push-1', 'push-2', 'push-3']);
  });

  it('has no operation-reply write entry and stops publishing after close', () => {
    const publish = vi.fn();
    const stream = createPluginSnapshotStream(publish);

    expect(Object.keys(stream).sort()).toEqual(['bootstrap', 'close', 'push']);
    stream.close();
    expect(stream.push(snapshots('late-push'))).toBe(false);
    expect(stream.bootstrap(snapshots('late-bootstrap'))).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps renderer snapshot state writes behind the stream', async () => {
    const source = await readFile(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('setPluginSnapshots((current)');
    expect(source.match(/setPluginSnapshots/g)).toHaveLength(2);
    expect(source).toContain('createPluginSnapshotStream(setPluginSnapshots)');
    expect(source).toContain("useState<PluginSnapshotAvailability>('loading')");
    expect(source).toContain("setPluginAvailability('ready')");
    expect(source).toContain("setPluginAvailability('unavailable')");
    expect(source).toContain('if (stream.bootstrap(result.value.snapshots))');
    // The renderer must not report snapshots as ready until main has spoken.
    expect(source).toContain('authoritative');
  });
});
