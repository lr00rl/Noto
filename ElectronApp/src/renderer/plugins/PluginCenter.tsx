import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { NotoDesktopApi, NotoPluginsApi, Result, ServiceRequest } from '../../shared/ipc/contracts';
import { IPC_VERSION } from '../../shared/ipc/contracts';
import { PLUGIN_LIFECYCLE_VERSION, type PluginLifecycleSnapshot } from '../../shared/plugins/lifecycle';
import {
  filesystemProofManifest,
  markdownPaddingManifest,
  rendererProofManifest,
  titleShiftManifest,
} from '../../shared/plugins/proof-manifests';

/** Display names for the trusted plugins, which lifecycle snapshots omit. */
const trustedNames = new Map<string, string>([
  [titleShiftManifest.id, titleShiftManifest.name],
  [markdownPaddingManifest.id, markdownPaddingManifest.name],
]);
import {
  createPluginActionCompletionTracker,
  pluginSnapshotIdentity,
  presentFilesystemPlugin,
  pluginOperationFailure,
  presentRendererPlugin,
  nextTrappedFocusIndex,
  shouldClosePluginCenter,
  watchPluginCenterModal,
  type FilesystemPrimaryAction,
  type PluginActionCompletionPolicy,
  type PluginActionSection,
  type PluginSnapshotAvailability,
  type RendererPrimaryAction,
} from './plugin-center-state';

type PluginMethods = Pick<NotoPluginsApi,
  'enable' | 'disable' | 'triggerEvent' | 'executeCommand' | 'setSetting' | 'replaceGeneration'>;
type ServiceRequestBody = ServiceRequest extends infer TRequest
  ? TRequest extends ServiceRequest
    ? Omit<TRequest, 'version' | 'requestId'>
    : never
  : never;

export interface PluginCenterApi {
  plugins: PluginMethods;
  requestService: NotoDesktopApi['requestService'];
}

interface PluginCenterProps {
  api: PluginCenterApi;
  snapshots: readonly PluginLifecycleSnapshot[];
  availability: PluginSnapshotAvailability;
  open: boolean;
  onClose: () => void;
  evidenceControls?: ReactNode;
}

const requestId = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;

type PendingActions = Record<PluginActionSection, string | null>;
type OperationErrors = Record<PluginActionSection, string | null>;

const emptyPending = (): PendingActions => ({ renderer: null, filesystem: null });
const emptyErrors = (): OperationErrors => ({ renderer: null, filesystem: null });

export function PluginCenter({ api, snapshots, availability, open, onClose, evidenceControls }: PluginCenterProps) {
  const [pendingAction, setPendingAction] = useState<PendingActions>(emptyPending);
  const [operationError, setOperationError] = useState<OperationErrors>(emptyErrors);
  const [modal, setModal] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const snapshotsRef = useRef(snapshots);
  const completionTrackerRef = useRef<ReturnType<typeof createPluginActionCompletionTracker> | null>(null);
  if (!completionTrackerRef.current) {
    completionTrackerRef.current = createPluginActionCompletionTracker({
      onIdle: (section) => setPendingAction((current) => ({ ...current, [section]: null })),
      onTimeout: (section) => {
        setPendingAction((current) => ({ ...current, [section]: null }));
        setOperationError((current) => ({ ...current, [section]: 'Plugin state did not update.' }));
      },
    });
  }
  snapshotsRef.current = snapshots;
  const renderer = snapshots.find((snapshot) => snapshot.id === rendererProofManifest.id);
  const filesystem = snapshots.find((snapshot) => snapshot.id === filesystemProofManifest.id);
  const rendererPresentation = presentRendererPlugin(renderer, availability);
  const filesystemPresentation = presentFilesystemPlugin(filesystem, availability);

  /**
   * Every other trusted plugin, rendered from its snapshot.
   *
   * Listing them from state rather than hand writing a section each means a new
   * bundled plugin appears here with no change to this component.
   */
  const trustedPlugins = snapshots
    .filter((snapshot) => snapshot.id !== rendererProofManifest.id
      && snapshot.id !== filesystemProofManifest.id)
    .map((snapshot) => ({
      snapshot: { ...snapshot, name: trustedNames.get(snapshot.id) ?? snapshot.id },
      presentation: presentRendererPlugin(snapshot, availability),
    }));

  useEffect(() => watchPluginCenterModal(
    (query) => window.matchMedia(query),
    setModal,
  ), []);

  useEffect(() => {
    completionTrackerRef.current?.observe(snapshots);
  }, [snapshots]);

  useEffect(() => () => completionTrackerRef.current?.dispose(), []);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => closeRef.current?.focus({ preventScroll: true }));
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldClosePluginCenter(event.key, open)) {
        event.preventDefault();
        onClose();
        return;
      }
      if (!modal || event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
      )].filter((element) => {
        if (element.offsetParent === null) return false;
        const closedDetails = element.closest('details:not([open])');
        return closedDetails === null || element.tagName === 'SUMMARY';
      });
      if (focusable.length === 0) return;
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = nextTrappedFocusIndex(current, event.shiftKey, focusable.length);
      if (next < 0) return;
      event.preventDefault();
      focusable[next]?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modal, onClose, open]);

  const run = async <T,>(section: PluginActionSection, key: string,
    completion: { type: 'reply' } | { type: 'snapshot'; pluginId: string },
    operation: () => Promise<Result<T>>) => {
    const policy: PluginActionCompletionPolicy = completion.type === 'reply'
      ? completion
      : {
        ...completion,
        beforeIdentity: pluginSnapshotIdentity(
          snapshotsRef.current.find((snapshot) => snapshot.id === completion.pluginId),
        ),
      };
    completionTrackerRef.current?.begin(section);
    setOperationError((current) => ({ ...current, [section]: null }));
    setPendingAction((current) => ({ ...current, [section]: key }));
    try {
      const result = await operation();
      const failure = pluginOperationFailure(result);
      if (failure) {
        setOperationError((current) => ({ ...current, [section]: failure }));
        completionTrackerRef.current?.fail(section);
        return false;
      }
      completionTrackerRef.current?.complete(section, policy, snapshotsRef.current);
      return true;
    } catch {
      setOperationError((current) => ({ ...current, [section]: 'Plugin connection unavailable.' }));
      completionTrackerRef.current?.fail(section);
      return false;
    }
  };

  const lifecycle = <T,>(section: PluginActionSection, prefix: string, pluginId: string,
    operation: () => Promise<Result<T>>) => (
    run(section, prefix, { type: 'snapshot', pluginId }, operation)
  );

  const rendererAction = (action: RendererPrimaryAction) => {
    if (action === 'enable') return lifecycle('renderer', 'renderer-enable', rendererProofManifest.id, () => api.plugins.enable({
      version: PLUGIN_LIFECYCLE_VERSION, requestId: requestId('plugin-enable-renderer'), pluginId: rendererProofManifest.id,
    }));
    if (action === 'disable' || action === 'retry-cleanup') return lifecycle('renderer', 'renderer-disable', rendererProofManifest.id, () => api.plugins.disable({
      version: PLUGIN_LIFECYCLE_VERSION, requestId: requestId('plugin-disable-renderer'), pluginId: rendererProofManifest.id,
    }));
    if (action === 'activate') return lifecycle('renderer', 'renderer-activate', rendererProofManifest.id, () => api.plugins.triggerEvent({
      version: PLUGIN_LIFECYCLE_VERSION, requestId: requestId('plugin-trigger-editor-ready'), event: 'editor.ready',
    }));
    return lifecycle('renderer', 'renderer-retry', rendererProofManifest.id, () => api.plugins.replaceGeneration({
      version: PLUGIN_LIFECYCLE_VERSION,
      requestId: requestId('plugin-retry-renderer'),
      pluginId: rendererProofManifest.id,
      reason: { type: 'event', event: 'editor.ready' },
    }));
  };

  /**
   * The same lifecycle actions, for any trusted-renderer plugin.
   *
   * The proof plugin keeps its bespoke section because it carries a setting and
   * diagnostics; everything else needs only enable, activate and disable, so it
   * is rendered from the snapshot rather than hand written per plugin.
   */
  const trustedAction = (pluginId: string, action: RendererPrimaryAction) => {
    if (action === 'enable') return lifecycle('renderer', `enable-${pluginId}`, pluginId, () => api.plugins.enable({
      version: PLUGIN_LIFECYCLE_VERSION, requestId: requestId('plugin-enable'), pluginId,
    }));
    if (action === 'disable' || action === 'retry-cleanup') {
      return lifecycle('renderer', `disable-${pluginId}`, pluginId, () => api.plugins.disable({
        version: PLUGIN_LIFECYCLE_VERSION, requestId: requestId('plugin-disable'), pluginId,
      }));
    }
    if (action === 'activate') return lifecycle('renderer', `activate-${pluginId}`, pluginId, () => api.plugins.triggerEvent({
      version: PLUGIN_LIFECYCLE_VERSION, requestId: requestId('plugin-trigger-editor-ready'), event: 'editor.ready',
    }));
    return lifecycle('renderer', `retry-${pluginId}`, pluginId, () => api.plugins.replaceGeneration({
      version: PLUGIN_LIFECYCLE_VERSION,
      requestId: requestId('plugin-retry'),
      pluginId,
      reason: { type: 'event', event: 'editor.ready' },
    }));
  };

  const serviceRequest = (key: string, request: ServiceRequestBody) => run(
    'filesystem', key, { type: 'snapshot', pluginId: filesystemProofManifest.id }, () => (
    api.requestService({ ...request, version: IPC_VERSION, requestId: requestId(key) } as ServiceRequest)
    ),
  );

  const filesystemAction = (action: FilesystemPrimaryAction) => {
    if (action === 'enable') return lifecycle('filesystem', 'filesystem-enable', filesystemProofManifest.id, () => api.plugins.enable({
      version: PLUGIN_LIFECYCLE_VERSION, requestId: requestId('plugin-enable-filesystem'), pluginId: filesystemProofManifest.id,
    }));
    if (action === 'start') return lifecycle('filesystem', 'filesystem-start', filesystemProofManifest.id, () => api.plugins.triggerEvent({
      version: PLUGIN_LIFECYCLE_VERSION, requestId: requestId('plugin-trigger-document-opened'), event: 'document.opened',
    }));
    if (action === 'restart') return lifecycle('filesystem', 'filesystem-restart', filesystemProofManifest.id, () => api.plugins.replaceGeneration({
      version: PLUGIN_LIFECYCLE_VERSION,
      requestId: requestId('plugin-restart-filesystem'),
      pluginId: filesystemProofManifest.id,
      reason: { type: 'event', event: 'document.opened' },
    }));
    if (action === 'retry-cleanup') return lifecycle('filesystem', 'filesystem-disable', filesystemProofManifest.id, () => api.plugins.disable({
      version: PLUGIN_LIFECYCLE_VERSION,
      requestId: requestId('plugin-cleanup-filesystem'),
      pluginId: filesystemProofManifest.id,
    }));
    if (!filesystem?.activeGeneration) return Promise.resolve(false);
    if (action === 'cancel') {
      const request = filesystem.capability.request;
      if (!request) return Promise.resolve(false);
      return serviceRequest('cancel-request', {
        action: 'cancel-request', generation: filesystem.activeGeneration, targetRequestId: request.requestId,
      });
    }
    if (action === 'read') {
      const grant = filesystem.capability.grant;
      if (!grant || grant.state !== 'active') return Promise.resolve(false);
      return serviceRequest('read-granted', {
        action: 'read-granted', generation: filesystem.activeGeneration, grantId: grant.id,
      });
    }
    return serviceRequest('grant-read', { action: 'grant-read', generation: filesystem.activeGeneration });
  };

  const activeGrant = filesystem?.capability.grant?.state === 'active'
    ? filesystem.capability.grant
    : null;
  const activeRequest = filesystem?.capability.request;

  return (
    <aside ref={panelRef} id="plugin-drawer" className={`plugin-panel ${open ? 'is-open' : ''}`}
      role={modal ? 'dialog' : undefined} aria-modal={modal ? true : undefined}
      aria-label="Plugins" aria-hidden={!open}>
      <div className="plugin-panel-heading">
        <div><h2>Plugins</h2><p>Extensions stay explicit and recoverable.</p></div>
        <button ref={closeRef} type="button" className="drawer-close" onClick={onClose}>Close</button>
      </div>

      {trustedPlugins.map(({ snapshot, presentation }) => (
        <section key={snapshot.id} className={`plugin-section plugin-tone-${presentation.tone}`}
          data-testid={`plugin-${snapshot.id}`} aria-busy={pendingAction.renderer !== null}>
          <div className="plugin-name-row"><strong>{snapshot.name}</strong></div>
          <p className="plugin-status" aria-live="polite">{presentation.status}</p>
          <p className="plugin-scope">{presentation.scope}</p>
          <button type="button" className="plugin-primary"
            disabled={presentation.actionDisabled || pendingAction.renderer !== null}
            onClick={() => presentation.primaryAction
              && void trustedAction(snapshot.id, presentation.primaryAction)}>
            {presentation.primaryLabel}
          </button>
        </section>
      ))}

      <section className={`plugin-section plugin-tone-${rendererPresentation.tone}`}
        data-testid="renderer-plugin-state" aria-busy={pendingAction.renderer !== null}>
        <div className="plugin-name-row"><strong>{rendererProofManifest.name}</strong></div>
        <p className="plugin-status" aria-live="polite" data-testid="renderer-plugin-lifecycle">
          {rendererPresentation.status}
        </p>
        <p className="plugin-scope">{rendererPresentation.scope}</p>
        <button type="button" className="plugin-primary"
          disabled={rendererPresentation.actionDisabled || pendingAction.renderer !== null}
          onClick={() => rendererPresentation.primaryAction
            && void rendererAction(rendererPresentation.primaryAction)}>
          {pendingAction.renderer ? 'Working…' : rendererPresentation.primaryLabel}
        </button>
        <label className="setting-row">
          <input type="checkbox" checked={renderer?.settings.focusEnabled ?? true}
            disabled={!renderer || availability !== 'ready' || pendingAction.renderer !== null}
            onChange={(event) => void run('renderer', 'renderer-setting',
              { type: 'snapshot', pluginId: rendererProofManifest.id }, () => api.plugins.setSetting({
              version: PLUGIN_LIFECYCLE_VERSION,
              requestId: requestId('plugin-setting'),
              pluginId: rendererProofManifest.id,
              key: 'focusEnabled',
              value: event.target.checked,
              }))} />
          Focus the active block
        </label>
        <p className="plugin-operation-message" aria-live="polite" aria-atomic="true" role="status">
          {operationError.renderer ?? ''}
        </p>
        <details className="plugin-diagnostics">
          <summary>Diagnostics</summary>
          <div className="diagnostic-actions">
            <button type="button" disabled={!renderer?.desiredEnabled || pendingAction.renderer !== null}
              onClick={() => void run('renderer', 'renderer-command', { type: 'reply' }, () => api.plugins.executeCommand({
                version: PLUGIN_LIFECYCLE_VERSION,
                requestId: requestId('plugin-command'),
                pluginId: rendererProofManifest.id,
                commandId: 'semantic-focus.toggle',
              }))}>Run command</button>
            {(renderer?.lifecycle === 'failed' || renderer?.lifecycle === 'crashed') && (
              <button type="button" disabled={pendingAction.renderer !== null}
                onClick={() => void rendererAction('disable')}>Disable</button>
            )}
          </div>
          <p>Version {rendererProofManifest.version} · trusted renderer · editor.decorate · hotkey ⌘⇧J</p>
          <p>Generation {renderer?.activeGeneration ?? 'none'} · registrations {renderer?.rendererRegistrations ?? 0} · leases {renderer?.leaseCount ?? 0}</p>
          <p>Persistence {renderer?.persistenceHealth ?? 'indeterminate'}</p>
          {renderer?.lastFailure && <p className="plugin-failure" role="status">{renderer.lastFailure}</p>}
        </details>
      </section>

      <section className={`plugin-section plugin-tone-${filesystemPresentation.tone}`}
        data-testid="service-state" aria-busy={pendingAction.filesystem !== null}>
        <div className="plugin-name-row"><strong>{filesystemProofManifest.name}</strong></div>
        <p className="plugin-status" aria-live="polite" data-testid="filesystem-plugin-lifecycle">
          {filesystemPresentation.status}
        </p>
        <p className="plugin-scope">{filesystemPresentation.scope}</p>
        <button type="button" className="plugin-primary"
          disabled={filesystemPresentation.actionDisabled || pendingAction.filesystem !== null}
          onClick={() => filesystemPresentation.primaryAction
            && void filesystemAction(filesystemPresentation.primaryAction)}>
          {pendingAction.filesystem ? 'Working…' : filesystemPresentation.primaryLabel}
        </button>
        <p className="plugin-operation-message" aria-live="polite" aria-atomic="true" role="status">
          {operationError.filesystem ?? ''}
        </p>
        <details className="plugin-diagnostics">
          <summary>Diagnostics</summary>
          <div className="diagnostic-actions">
            <button type="button" disabled={!activeGrant || activeRequest?.state === 'pending' || pendingAction.filesystem !== null}
              onClick={() => activeGrant && filesystem?.activeGeneration && void serviceRequest('read-granted', {
                action: 'read-granted', grantId: activeGrant.id, generation: filesystem.activeGeneration,
              })}>Read granted fixture</button>
            <button type="button" disabled={!activeGrant || activeRequest?.state === 'pending' || pendingAction.filesystem !== null}
              onClick={() => activeGrant && filesystem?.activeGeneration && void serviceRequest('deny-probe', {
                action: 'deny-probe', grantId: activeGrant.id, generation: filesystem.activeGeneration,
              })}>Prove denied path</button>
            <button type="button" disabled={!activeGrant || pendingAction.filesystem !== null}
              onClick={() => activeGrant && filesystem?.activeGeneration && void serviceRequest('revoke-grant', {
                action: 'revoke-grant', grantId: activeGrant.id, generation: filesystem.activeGeneration,
              })}>Revoke access</button>
            {filesystem?.desiredEnabled && (
              <button type="button" disabled={pendingAction.filesystem !== null}
                onClick={() => void lifecycle('filesystem', 'filesystem-disable', filesystemProofManifest.id, () => api.plugins.disable({
                  version: PLUGIN_LIFECYCLE_VERSION,
                  requestId: requestId('plugin-disable-filesystem'),
                  pluginId: filesystemProofManifest.id,
                }))}>Disable</button>
            )}
            {filesystem?.lifecycle === 'active' && (
              <button type="button" disabled={pendingAction.filesystem !== null}
                onClick={() => void filesystemAction('restart')}>
                Restart service (revokes current access)
              </button>
            )}
          </div>
          <p>Version {filesystemProofManifest.version} · bundled utility process · filesystem.read</p>
          <p>{activeRequest
            ? `${activeRequest.action} · ${activeRequest.state} · ${activeRequest.detail}`
            : 'No service operation yet'}</p>
          <p>Generation {filesystem?.activeGeneration ?? 'none'} · persistence {filesystem?.persistenceHealth ?? 'indeterminate'}</p>
          {filesystem?.lastFailure && <p className="plugin-failure" role="status">{filesystem.lastFailure}</p>}
          <p>The main-process grant broker limits cooperative bundled code to the selected folder. It does not contain hostile code.</p>
          {filesystem?.lifecycle === 'active' && activeGrant && (
            <p>Restarting stops the service and revokes the current folder grant before a new generation starts.</p>
          )}
        </details>
      </section>

      {evidenceControls && <details className="plugin-evidence"><summary>G001 evidence controls</summary>{evidenceControls}</details>}
    </aside>
  );
}
