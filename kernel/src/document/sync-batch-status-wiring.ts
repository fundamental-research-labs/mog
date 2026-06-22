import type { AdmittedSyncApplyContext } from '../bridges/compute/sync-apply-admission';
import {
  hasSyncBatchStatusStoreProvider,
  syncBatchStatusKeyMaterialForOperationContext,
  type SyncBatchStatusId,
  type SyncBatchStatusOperationContext,
  type SyncBatchStatusReserveResult,
  type SyncBatchStatusStore,
  type SyncBatchStatusStoreDiagnostic,
  type SyncBatchStatusTerminal,
} from './version-store/sync-batch-status-store';

export type { SyncBatchStatusStore };

export type SyncBatchStatusReservation = {
  readonly store: SyncBatchStatusStore;
  readonly batchStatusId: SyncBatchStatusId;
  readonly batchId: string;
  readonly operationContext: SyncBatchStatusOperationContext;
  readonly payloadHash: string;
  readonly orderedSubUpdatePayloadHashes: readonly string[];
  readonly subUpdateCount: number;
};

export type SyncBatchStatusPreApplyRejectionReason =
  | 'sync-batch-status-conflict'
  | 'sync-batch-status-reservation-failed'
  | 'sync-batch-status-failed-after-mutation'
  | 'sync-batch-status-terminal-rejected';

export type SyncBatchStatusPreApplyDecision =
  | {
      readonly status: 'apply';
      readonly reservation: SyncBatchStatusReservation | null;
    }
  | { readonly status: 'duplicate' }
  | {
      readonly status: 'rejected';
      readonly reason: SyncBatchStatusPreApplyRejectionReason;
    };

export async function openSyncBatchStatusStoreFromProvider(
  provider: unknown,
): Promise<SyncBatchStatusStore | undefined> {
  if (!hasSyncBatchStatusStoreProvider(provider)) return undefined;
  return provider.openSyncBatchStatusStore();
}

export async function prepareSyncBatchStatusBeforeApply(options: {
  readonly store: SyncBatchStatusStore | undefined;
  readonly admittedContext: AdmittedSyncApplyContext;
}): Promise<SyncBatchStatusPreApplyDecision> {
  let reservation: SyncBatchStatusReservation | null;
  try {
    reservation = await syncBatchStatusReservationForAdmittedContext(
      options.store,
      options.admittedContext,
    );
  } catch {
    return { status: 'rejected', reason: 'sync-batch-status-reservation-failed' };
  }

  if (!reservation) return { status: 'apply', reservation: null };

  let reserved: SyncBatchStatusReserveResult;
  try {
    reserved = await reservation.store.reserveBatchStatus({
      batchStatusId: reservation.batchStatusId,
      operationContext: reservation.operationContext,
      batchId: reservation.batchId,
      orderedSubUpdatePayloadHashes: reservation.orderedSubUpdatePayloadHashes,
      subUpdateCount: reservation.subUpdateCount,
      createdAt: new Date().toISOString(),
    });
  } catch {
    return { status: 'rejected', reason: 'sync-batch-status-reservation-failed' };
  }

  switch (reserved.status) {
    case 'reserved':
      return { status: 'apply', reservation };
    case 'existing':
      if (reserved.record.state === 'failedAfterMutation') {
        return { status: 'rejected', reason: 'sync-batch-status-failed-after-mutation' };
      }
      if (reserved.record.state === 'dropped' || reserved.record.state === 'rejected') {
        return { status: 'rejected', reason: 'sync-batch-status-terminal-rejected' };
      }
      return { status: 'apply', reservation };
    case 'duplicate':
      return { status: 'duplicate' };
    case 'conflict':
      return { status: 'rejected', reason: 'sync-batch-status-conflict' };
    case 'failed':
      return { status: 'rejected', reason: 'sync-batch-status-reservation-failed' };
  }
}

async function syncBatchStatusReservationForAdmittedContext(
  store: SyncBatchStatusStore | undefined,
  admittedContext: AdmittedSyncApplyContext,
): Promise<SyncBatchStatusReservation | null> {
  if (!store) return null;
  const collaboration = admittedContext.operationContext.collaboration;
  if (collaboration?.sourceKind !== 'providerLiveInbound') {
    return null;
  }

  const orderedSubUpdatePayloadHashes = [admittedContext.payloadHash];
  const subUpdateCount = 1;
  const batchId = admittedContext.updateId ?? collaboration.updateId;
  if (!batchId) throw new Error('Sync batch status reservation requires an update id.');
  const { batchStatusId } = await syncBatchStatusKeyMaterialForOperationContext(
    admittedContext.operationContext,
    { batchId, orderedSubUpdatePayloadHashes, subUpdateCount },
  );
  return {
    store,
    batchStatusId,
    batchId,
    operationContext: admittedContext.operationContext as SyncBatchStatusOperationContext,
    payloadHash: admittedContext.payloadHash,
    orderedSubUpdatePayloadHashes,
    subUpdateCount,
  };
}

export async function completeSyncBatchStatus(
  reservation: SyncBatchStatusReservation,
): Promise<void> {
  await completeSyncBatchStatusTerminal(reservation, { status: 'complete' });
}

export async function completeSyncBatchStatusFailedAfterMutation(
  reservation: SyncBatchStatusReservation,
): Promise<void> {
  await completeSyncBatchStatusTerminal(reservation, {
    status: 'failedAfterMutation',
    reason: 'sync-apply-failed',
  });
}

async function completeSyncBatchStatusTerminal(
  reservation: SyncBatchStatusReservation,
  terminal: SyncBatchStatusTerminal,
): Promise<void> {
  const completed = await reservation.store.completeBatchStatus({
    batchStatusId: reservation.batchStatusId,
    payloadHash: reservation.payloadHash,
    orderedSubUpdatePayloadHashes: reservation.orderedSubUpdatePayloadHashes,
    subUpdateCount: reservation.subUpdateCount,
    completedAt: new Date().toISOString(),
    terminal,
  });

  if (completed.status !== 'completed') {
    throw new Error(
      `RustDocument.applyProviderUpdate: sync batch status completion failed (${completed.status})${formatDiagnostics(
        completed.diagnostics,
      )}`,
    );
  }
}

function formatDiagnostics(diagnostics: readonly SyncBatchStatusStoreDiagnostic[]): string {
  if (diagnostics.length === 0) return '';
  return `: ${diagnostics.map((diagnostic) => diagnostic.message).join('; ')}`;
}
