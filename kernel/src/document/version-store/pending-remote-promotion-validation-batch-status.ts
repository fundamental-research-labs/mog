import type { PendingRemoteSegmentRecord } from './pending-remote-segment-store';
import {
  pendingRemotePromotionDiagnostic as diagnostic,
  pendingRemotePromotionErrorMessage as errorMessage,
} from './pending-remote-promotion-diagnostics';
import type { PendingRemotePromotionBatchStatusDecision } from './pending-remote-promotion-validation-types';
import {
  syncBatchStatusKeyMaterialForOperationContext,
  type SyncBatchStatusId,
  type SyncBatchStatusRecord,
  type SyncBatchStatusStore,
} from './sync-batch-status-store';

export async function pendingRemotePromotionBatchStatusDecision(
  record: PendingRemoteSegmentRecord,
  store: SyncBatchStatusStore | undefined,
): Promise<PendingRemotePromotionBatchStatusDecision> {
  if (store === undefined) return { status: 'ok', diagnostics: [] };

  let batchStatusId: SyncBatchStatusId;
  try {
    batchStatusId = (await syncBatchStatusKeyMaterialForOperationContext(record.operationContext))
      .batchStatusId;
  } catch {
    return { status: 'ok', diagnostics: [] };
  }

  let read: Awaited<ReturnType<SyncBatchStatusStore['readByBatchStatusId']>>;
  try {
    read = await store.readByBatchStatusId(batchStatusId);
  } catch (error) {
    read = {
      status: 'failed',
      record: null,
      diagnostics: [
        {
          code: 'VERSION_PROVIDER_FAILED',
          message: 'Sync batch status read threw before returning a result.',
          recoverability: 'retry',
          details: { cause: errorMessage(error) },
        },
      ],
    };
  }
  if (read.status === 'missing') return { status: 'ok', diagnostics: [] };
  if (read.status === 'failed') {
    const message = 'Referenced sync batch status could not be read for pending remote promotion.';
    return {
      status: 'blocked',
      reason: 'batch-status-read-failed',
      message,
      diagnostics: [
        diagnostic('VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED', 'error', message, {
          reason: 'batch-status-read-failed',
          segmentId: record.pendingRemoteSegmentId,
          sourceDiagnostics: read.diagnostics,
        }),
      ],
    };
  }

  if (isTerminalBlockedBatchStatus(read.record)) {
    const message = 'Referenced sync batch status is terminal failed, dropped, or rejected.';
    return {
      status: 'blocked',
      reason: 'batch-status-terminal',
      message,
      diagnostics: [
        diagnostic('VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED', 'warning', message, {
          reason: 'batch-status-terminal',
          segmentId: record.pendingRemoteSegmentId,
          details: { batchStatusState: read.record.state },
        }),
      ],
    };
  }

  return { status: 'ok', diagnostics: [] };
}

function isTerminalBlockedBatchStatus(record: SyncBatchStatusRecord): boolean {
  return (
    record.state === 'failedAfterMutation' ||
    record.state === 'dropped' ||
    record.state === 'rejected'
  );
}
