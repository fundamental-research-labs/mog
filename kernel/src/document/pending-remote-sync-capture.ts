import type { AdmittedSyncApplyContext } from '../bridges/compute/sync-apply-admission';
import { slog } from '../lib/slog';
import type { AppliedSyncUpdateIdentityAppliedTerminalMetadata } from './applied-sync-update-identity-wiring';
import type { VersionPendingRemoteCapture } from './version-store/pending-remote-capture-service';
import { hasPendingRemoteSegmentStoreProvider } from './version-store/pending-remote-segment-store';
import type { VersionStoreProvider } from './version-store/provider';
import { namespaceForRegistry } from './version-store/registry';
import type { SnapshotRootByteSyncPort } from './version-store/snapshot-root-capture';

export type PendingRemoteSyncCaptureServices = {
  readonly provider?: VersionStoreProvider;
  readonly capturePendingRemoteSegment?: VersionPendingRemoteCapture;
  readonly snapshotRootByteSyncPort?: SnapshotRootByteSyncPort;
};

export async function capturePendingRemoteSegmentForAdmittedContext(input: {
  readonly docId: string;
  readonly admittedContext: AdmittedSyncApplyContext;
  readonly services: PendingRemoteSyncCaptureServices;
}): Promise<AppliedSyncUpdateIdentityAppliedTerminalMetadata | undefined> {
  if (input.admittedContext.operationContext.collaboration?.commitGrouping !== 'pendingRemote') {
    return undefined;
  }

  const { provider, capturePendingRemoteSegment } = input.services;
  if (!provider || !capturePendingRemoteSegment) return undefined;
  if (!hasPendingRemoteSegmentStoreProvider(provider)) {
    slog('rustDocument.applyProviderUpdatePendingRemoteCaptureUnavailable', {
      docId: input.docId,
      reason: 'missing-pending-remote-segment-store',
    });
    return undefined;
  }

  const registryRead = await provider.readGraphRegistry();
  if (registryRead.status !== 'ok') {
    slog('rustDocument.applyProviderUpdatePendingRemoteCaptureSkipped', {
      docId: input.docId,
      reason: registryRead.status,
    });
    return undefined;
  }

  const namespace = namespaceForRegistry(registryRead.registry);
  const graph = await provider.openGraph(namespace, provider.accessContext);
  const pendingRemoteSegmentStore = await provider.openPendingRemoteSegmentStore(namespace);
  const captured = await capturePendingRemoteSegment({
    provider,
    graph,
    accessContext: provider.accessContext,
    namespace,
    registry: registryRead.registry,
    pendingRemoteSegmentStore,
    operationContext: input.admittedContext.operationContext,
    snapshotRootByteSyncPort: input.services.snapshotRootByteSyncPort,
  });

  if (captured.status === 'ignored') return undefined;
  if (captured.status === 'failed') {
    throw new Error(
      `RustDocument.applyProviderUpdate: pending remote segment capture failed (${captured.diagnostics
        .map((diagnostic) => diagnostic.message)
        .join('; ')})`,
    );
  }

  return {
    pendingRemoteSegmentId: captured.record.pendingRemoteSegmentId,
    mutationSegmentDigest: captured.record.mutationSegmentDigest,
  };
}
