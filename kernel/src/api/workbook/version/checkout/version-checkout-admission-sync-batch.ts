import {
  hasPendingRemoteSegmentStoreProvider,
  type PendingRemoteSegmentRecord,
} from '../../../../document/version-store/pending-remote-segment-store';
import { namespaceForRegistry } from '../../../../document/version-store/registry';
import {
  hasSyncBatchStatusStoreProvider,
  syncBatchStatusKeyMaterialForOperationContext,
  type SyncBatchStatusId,
  type SyncBatchStatusState,
  type SyncBatchStatusStore,
  type SyncBatchStatusTerminal,
} from '../../../../document/version-store/sync-batch-status-store';
import { getAttachedVersionStoreProvider } from './version-checkout-admission-services';
import type {
  PendingProviderWriteNumberPayload,
  PendingProviderWritePayload,
  VersionCheckoutAdmissionBlock,
} from './version-checkout-admission-types';

export async function readSyncBatchStatusAdmissionBlock(
  services: unknown,
): Promise<Extract<VersionCheckoutAdmissionBlock, { reason: 'syncBatchStatusBlocked' }> | null> {
  const provider = getAttachedVersionStoreProvider(services);
  if (
    !provider ||
    !hasPendingRemoteSegmentStoreProvider(provider) ||
    !hasSyncBatchStatusStoreProvider(provider)
  ) {
    return null;
  }

  try {
    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') return null;

    const pendingStore = await provider.openPendingRemoteSegmentStore(
      namespaceForRegistry(registry.registry),
    );
    const listed = await pendingStore.listByState('pending');
    if (listed.status !== 'success' || listed.records.length === 0) return null;

    const syncBatchStatusStore = await provider.openSyncBatchStatusStore();
    const payload = await syncBatchStatusPayloadForPendingSegments(
      listed.records,
      syncBatchStatusStore,
    );
    return hasSyncBatchStatusBlockers(payload)
      ? { reason: 'syncBatchStatusBlocked', ...payload }
      : null;
  } catch {
    return null;
  }
}

async function syncBatchStatusPayloadForPendingSegments(
  records: readonly PendingRemoteSegmentRecord[],
  store: SyncBatchStatusStore,
): Promise<PendingProviderWritePayload> {
  const payload: PendingProviderWritePayload = {
    pendingRemoteSegmentCount: records.length,
  };
  for (const record of records) {
    const batchStatusId = await batchStatusIdForPendingRemoteSegment(record);
    if (!batchStatusId) continue;

    let read: Awaited<ReturnType<SyncBatchStatusStore['readByBatchStatusId']>>;
    try {
      read = await store.readByBatchStatusId(batchStatusId);
    } catch {
      incrementPendingProviderPayload(payload, 'syncBatchStatusReadFailedCount');
      assignFirstSyncBatchStatus(payload, {
        state: 'readFailed',
        segmentId: record.pendingRemoteSegmentId,
        batchStatusId,
      });
      continue;
    }

    if (read.status === 'missing') continue;
    if (read.status === 'failed') {
      incrementPendingProviderPayload(payload, 'syncBatchStatusReadFailedCount');
      assignFirstSyncBatchStatus(payload, {
        state: 'readFailed',
        segmentId: record.pendingRemoteSegmentId,
        batchStatusId,
      });
      continue;
    }

    const state = read.record.state;
    if (state === 'pending') {
      incrementPendingProviderPayload(payload, 'syncBatchStatusPendingCount');
      assignFirstSyncBatchStatus(payload, {
        state,
        segmentId: record.pendingRemoteSegmentId,
        batchStatusId,
      });
      continue;
    }

    if (isBlockedSyncBatchTerminal(state)) {
      incrementPendingProviderPayload(payload, 'syncBatchStatusTerminalCount');
      switch (state) {
        case 'failedAfterMutation':
          incrementPendingProviderPayload(payload, 'syncBatchStatusFailedAfterMutationCount');
          break;
        case 'dropped':
          incrementPendingProviderPayload(payload, 'syncBatchStatusDroppedCount');
          break;
        case 'rejected':
          incrementPendingProviderPayload(payload, 'syncBatchStatusRejectedCount');
          break;
      }
      assignFirstSyncBatchStatus(payload, {
        state,
        reason: terminalReason(read.record.terminal),
        segmentId: record.pendingRemoteSegmentId,
        batchStatusId,
      });
    }
  }

  if (payload.syncBatchStatusPendingCount !== undefined) {
    payload.syncBatchStatusBlockedCount =
      (payload.syncBatchStatusBlockedCount ?? 0) + payload.syncBatchStatusPendingCount;
  }
  if (payload.syncBatchStatusTerminalCount !== undefined) {
    payload.syncBatchStatusBlockedCount =
      (payload.syncBatchStatusBlockedCount ?? 0) + payload.syncBatchStatusTerminalCount;
  }
  if (payload.syncBatchStatusReadFailedCount !== undefined) {
    payload.syncBatchStatusBlockedCount =
      (payload.syncBatchStatusBlockedCount ?? 0) + payload.syncBatchStatusReadFailedCount;
  }
  return payload;
}

async function batchStatusIdForPendingRemoteSegment(
  record: PendingRemoteSegmentRecord,
): Promise<SyncBatchStatusId | null> {
  const direct = record.operationContext.collaboration.batchStatusId;
  if (isSyncBatchStatusId(direct)) return direct;
  try {
    return (await syncBatchStatusKeyMaterialForOperationContext(record.operationContext))
      .batchStatusId;
  } catch {
    return null;
  }
}

function isBlockedSyncBatchTerminal(
  state: SyncBatchStatusState,
): state is 'failedAfterMutation' | 'dropped' | 'rejected' {
  return state === 'failedAfterMutation' || state === 'dropped' || state === 'rejected';
}

function terminalReason(terminal: SyncBatchStatusTerminal | undefined): string | undefined {
  return terminal && 'reason' in terminal ? terminal.reason : undefined;
}

function hasSyncBatchStatusBlockers(payload: PendingProviderWritePayload): boolean {
  return (
    (payload.syncBatchStatusPendingCount ?? 0) > 0 ||
    (payload.syncBatchStatusTerminalCount ?? 0) > 0 ||
    (payload.syncBatchStatusReadFailedCount ?? 0) > 0
  );
}

function incrementPendingProviderPayload(
  payload: PendingProviderWriteNumberPayload,
  key: keyof PendingProviderWriteNumberPayload,
): void {
  payload[key] = (payload[key] ?? 0) + 1;
}

function assignFirstSyncBatchStatus(
  payload: PendingProviderWritePayload,
  input: {
    readonly state: string;
    readonly reason?: string;
    readonly segmentId: string;
    readonly batchStatusId: string;
  },
): void {
  payload.syncBatchStatusFirstState ??= input.state;
  payload.syncBatchStatusFirstSegmentId ??= input.segmentId;
  payload.syncBatchStatusFirstBatchStatusId ??= input.batchStatusId;
  if (input.reason !== undefined) payload.syncBatchStatusFirstReason ??= input.reason;
}

function isSyncBatchStatusId(value: unknown): value is SyncBatchStatusId {
  return typeof value === 'string' && /^sync-batch-status:sha256:[0-9a-f]{64}$/.test(value);
}
