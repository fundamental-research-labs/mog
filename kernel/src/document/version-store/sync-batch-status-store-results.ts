import { syncBatchStatusPendingBacklogSemanticsForReason } from './sync-batch-status-record-codec';
import type {
  SyncBatchStatusCompleteResult,
  SyncBatchStatusReadResult,
  SyncBatchStatusRecord,
  SyncBatchStatusReserveResult,
  SyncBatchStatusStoreDiagnostic,
} from './sync-batch-status-store';

export function conflictReserveSyncBatchStatusResult(
  record: SyncBatchStatusRecord,
  message: string,
): Extract<SyncBatchStatusReserveResult, { status: 'conflict' }> {
  return {
    status: 'conflict',
    record,
    pendingBacklogSemantics: syncBatchStatusPendingBacklogSemanticsForReason('reservationConflict'),
    diagnostics: [syncBatchStatusDiagnostic('VERSION_SYNC_BATCH_STATUS_CONFLICT', message, 'none')],
  };
}

export function conflictCompleteSyncBatchStatusResult(
  record: SyncBatchStatusRecord,
  message: string,
): SyncBatchStatusCompleteResult {
  return {
    status: 'conflict',
    record,
    pendingBacklogSemantics: syncBatchStatusPendingBacklogSemanticsForReason('reservationConflict'),
    diagnostics: [syncBatchStatusDiagnostic('VERSION_SYNC_BATCH_STATUS_CONFLICT', message, 'none')],
  };
}

export function failedReserveSyncBatchStatusResult(
  message: string,
): Extract<SyncBatchStatusReserveResult, { status: 'failed' }> {
  return {
    status: 'failed',
    record: null,
    pendingBacklogSemantics: syncBatchStatusPendingBacklogSemanticsForReason('reservationFailure'),
    diagnostics: [syncBatchStatusDiagnostic('VERSION_INVALID_OPTIONS', message, 'none')],
  };
}

export function missingSyncBatchStatusReadResult(message: string): SyncBatchStatusReadResult {
  return {
    status: 'missing',
    record: null,
    pendingBacklogSemantics: syncBatchStatusPendingBacklogSemanticsForReason('missing'),
    diagnostics: [
      syncBatchStatusDiagnostic('VERSION_SYNC_BATCH_STATUS_NOT_FOUND', message, 'repair'),
    ],
  };
}

export function missingSyncBatchStatusCompleteResult(): SyncBatchStatusCompleteResult {
  return {
    status: 'missing',
    record: null,
    pendingBacklogSemantics: syncBatchStatusPendingBacklogSemanticsForReason('missing'),
    diagnostics: [
      syncBatchStatusDiagnostic(
        'VERSION_SYNC_BATCH_STATUS_NOT_FOUND',
        'Sync batch status was not found.',
        'repair',
      ),
    ],
  };
}

function syncBatchStatusDiagnostic(
  code: SyncBatchStatusStoreDiagnostic['code'],
  message: string,
  recoverability: SyncBatchStatusStoreDiagnostic['recoverability'],
  details?: SyncBatchStatusStoreDiagnostic['details'],
): SyncBatchStatusStoreDiagnostic {
  return details === undefined
    ? { code, message, recoverability }
    : { code, message, recoverability, details };
}
