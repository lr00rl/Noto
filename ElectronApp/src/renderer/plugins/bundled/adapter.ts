/**
 * Bridges a trusted plugin onto the lifecycle host's contribution interface.
 *
 * The host speaks in leases, generations and abort signals because it has to.
 * A transform plugin should not: it registers a command and edits markdown.
 * This adapter keeps that separation, so the plugins stay readable and the host
 * keeps its guarantees.
 */

import type { ProofPluginActivationContext } from '../renderer-proof/plugin';
import type { NotoEditorPort } from '../../editor/noto/NotoEditorPort';
import type { TrustedPlugin, TrustedPluginContext } from './index';

type Disposer = () => void;

export function adaptTrustedPlugin(plugin: TrustedPlugin) {
  return {
    activate(context: ProofPluginActivationContext): Disposer {
      const trustedContext: TrustedPluginContext = {
        pluginId: context.pluginId,
        settings: context.settings,
        signal: context.signal,
        port: context.port,
        registerCommand: (id, execute) => context.registerCommand(id, () => execute()),
        registerHotkey: (keys, execute) => context.registerHotkey(keys, () => execute()),
        registerDisposer: (disposer) => context.registerDisposer(disposer),
        // Routed through the host so a notice is attributed to its plugin and
        // disappears with it, rather than outliving the lease that raised it.
        notice: () => context.onCommand(),
      };
      return plugin.activate(trustedContext);
    },
  };
}
