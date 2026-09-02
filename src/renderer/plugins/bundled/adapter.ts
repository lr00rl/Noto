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
        // Counted through the host so a notice is attributed to its plugin,
        // and shown by the shell in the status line for a moment. An event
        // rather than a host method: the shell is the one thing that knows
        // where a message goes, and the host keeps to leases and generations.
        notice: (message) => {
          context.onCommand();
          window.dispatchEvent(new CustomEvent('noto:notice', { detail: message }));
        },
      };
      return plugin.activate(trustedContext);
    },
  };
}
