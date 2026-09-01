import type { PluginLifecycleSnapshot } from '../../shared/plugins/lifecycle';

type PublishSnapshots = (snapshots: PluginLifecycleSnapshot[]) => void;

export function createPluginSnapshotStream(publish: PublishSnapshots) {
  let closed = false;
  let pushReceived = false;
  let bootstrapAccepted = false;

  return Object.freeze({
    bootstrap(snapshots: PluginLifecycleSnapshot[]): boolean {
      if (closed || pushReceived || bootstrapAccepted) return false;
      bootstrapAccepted = true;
      publish(snapshots);
      return true;
    },
    push(snapshots: PluginLifecycleSnapshot[]): boolean {
      if (closed) return false;
      pushReceived = true;
      publish(snapshots);
      return true;
    },
    close(): void {
      closed = true;
    },
  });
}
