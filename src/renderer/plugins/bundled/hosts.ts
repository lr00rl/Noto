/**
 * The renderer plugins this build ships, each in its own host.
 *
 * Adding a plugin here is the only wiring step: main discovers it from the
 * bundled manifest catalog, the Plugin Center renders it from the lifecycle
 * snapshot, and the client routes its leases here by id.
 */

import {
  markdownPaddingManifest,
  rendererProofManifest,
  titleShiftManifest,
} from '../../../shared/plugins/proof-manifests';
import { SemanticFocusProofPlugin } from '../renderer-proof/plugin';
import { RendererPluginHost } from '../RendererPluginHost';
import { MarkdownPaddingPlugin, TitleShiftPlugin, type TrustedPlugin } from './index';
import { adaptTrustedPlugin } from './adapter';

export function createRendererPluginHosts(): ReadonlyMap<string, RendererPluginHost> {
  const trusted: readonly [typeof titleShiftManifest | typeof markdownPaddingManifest, TrustedPlugin][] = [
    [titleShiftManifest, new TitleShiftPlugin()],
    [markdownPaddingManifest, new MarkdownPaddingPlugin()],
  ];

  const hosts = new Map<string, RendererPluginHost>();
  hosts.set(rendererProofManifest.id, new RendererPluginHost(() => undefined, {
    manifest: rendererProofManifest,
    plugin: new SemanticFocusProofPlugin(),
  }));
  for (const [manifest, plugin] of trusted) {
    hosts.set(manifest.id, new RendererPluginHost(() => undefined, {
      manifest,
      plugin: adaptTrustedPlugin(plugin),
    }));
  }
  return hosts;
}
