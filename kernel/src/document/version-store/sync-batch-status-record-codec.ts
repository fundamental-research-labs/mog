import { isObjectDigest } from './object-digest';
import { versionDocumentScopeKey, type VersionDocumentScope } from './registry';
import {
  isSanitizedSyncBatchStatusCollaboration,
  isSyncBatchOperationContext,
  isSyncBatchStatusIdentity,
  sanitizeSyncBatchStatusOperationContext,
  syncBatchOperationContext,
  syncBatchStatusIdentityMatchesOperationContext,
  syncBatchStatusKeyMaterialForOperationContext,
} from './sync-batch-status-identity';
import { canonicalJsonStringify, cloneJson, isRecord } from './sync-batch-status-json';
import type {
  CompleteSyncBatchStatusInput,
  ReserveSyncBatchStatusInput,
  SyncBatchStatusId,
  SyncBatchStatusPendingBacklogReason,
  SyncBatchStatusPendingBacklogSemantics,
  SyncBatchStatusRecord,
  SyncBatchStatusState,
  SyncBatchStatusTerminal,
} from './sync-batch-status-store';

export async function syncBatchStatusRecordFromReserveInput(
  input: ReserveSyncBatchStatusInput,
  documentScopeKey: string,
): Promise<SyncBatchStatusRecord> {
  const collaboration = syncBatchOperationContext(input.operationContext);
  const keyMaterial = await syncBatchStatusKeyMaterialForOperationContext(
    input.operationContext,
    input,
  );
  if (input.batchStatusId !== keyMaterial.batchStatusId) {
    throw new Error('Sync batch status id does not match operation context.');
  }
  return cloneSyncBatchStatusRecord({
    schemaVersion: 1,
    recordKind: 'syncBatchStatus',
    batchStatusId: input.batchStatusId,
    documentScopeKey,
    sourceKind: collaboration.sourceKind,
    identity: keyMaterial.identity,
    operationContext: sanitizeSyncBatchStatusOperationContext(input.operationContext),
    state: 'pending',
    pendingBacklogSemantics: syncBatchStatusPendingBacklogSemanticsForRecord({
      state: 'pending',
      operationContext: input.operationContext,
    }),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function completeSyncBatchStatusRecord(
  existing: SyncBatchStatusRecord,
  input: CompleteSyncBatchStatusInput,
): SyncBatchStatusRecord {
  return {
    ...existing,
    state: input.terminal.status,
    updatedAt: input.completedAt,
    terminal: cloneJson(input.terminal),
    pendingBacklogSemantics: syncBatchStatusPendingBacklogSemanticsForRecord({
      ...existing,
      state: input.terminal.status,
    }),
  };
}

export function cloneSyncBatchStatusRecord(record: SyncBatchStatusRecord): SyncBatchStatusRecord;
export function cloneSyncBatchStatusRecord(record: undefined): undefined;
export function cloneSyncBatchStatusRecord(
  record: SyncBatchStatusRecord | undefined,
): SyncBatchStatusRecord | undefined;
export function cloneSyncBatchStatusRecord(
  record: SyncBatchStatusRecord | undefined,
): SyncBatchStatusRecord | undefined {
  if (record === undefined) return undefined;
  const { pendingBacklogSemantics: _ignored, ...cloned } = cloneJson(record);
  const normalized = {
    ...cloned,
    operationContext: sanitizeSyncBatchStatusOperationContext(cloned.operationContext),
  };
  return {
    ...normalized,
    pendingBacklogSemantics: syncBatchStatusPendingBacklogSemanticsForRecord(normalized),
  };
}

export function syncBatchStatusReservationsEquivalent(
  left: SyncBatchStatusRecord,
  right: SyncBatchStatusRecord,
): boolean {
  return (
    canonicalJsonStringify(syncBatchStatusReservationIdentity(left)) ===
    canonicalJsonStringify(syncBatchStatusReservationIdentity(right))
  );
}

export function syncBatchStatusTerminalsEqual(
  left: SyncBatchStatusTerminal,
  right: SyncBatchStatusTerminal,
): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

export function syncBatchStatusPendingBacklogSemanticsForRecord(
  record: Pick<SyncBatchStatusRecord, 'operationContext' | 'state'>,
): SyncBatchStatusPendingBacklogSemantics {
  switch (record.state) {
    case 'pending':
      return isBlockedBatchFailureRecord(record)
        ? syncBatchStatusPendingBacklogSemanticsForReason('blockedBatchFailure')
        : syncBatchStatusPendingBacklogSemanticsForReason('pending');
    case 'complete':
      return syncBatchStatusPendingBacklogSemanticsForReason('complete');
    case 'failedAfterMutation':
      return syncBatchStatusPendingBacklogSemanticsForReason('failedAfterMutation');
    case 'dropped':
      return syncBatchStatusPendingBacklogSemanticsForReason('terminalDropped');
    case 'rejected':
      return syncBatchStatusPendingBacklogSemanticsForReason('terminalRejected');
  }
}

export function syncBatchStatusPendingBacklogSemanticsForReason(
  reason: SyncBatchStatusPendingBacklogReason,
): SyncBatchStatusPendingBacklogSemantics {
  switch (reason) {
    case 'pending':
      return { pendingForCheckout: true, backlogForAdmission: true, reason };
    case 'complete':
    case 'missing':
      return { pendingForCheckout: false, backlogForAdmission: false, reason };
    case 'providerFailure':
      return { pendingForCheckout: true, backlogForAdmission: true, reason };
    case 'failedAfterMutation':
    case 'terminalDropped':
    case 'terminalRejected':
    case 'blockedBatchFailure':
    case 'reservationConflict':
    case 'reservationFailure':
      return { pendingForCheckout: false, backlogForAdmission: true, reason };
  }
}

export function syncBatchStatusStorageKey(
  documentScope: VersionDocumentScope,
  batchStatusId: SyncBatchStatusId,
): string {
  return `${versionDocumentScopeKey(documentScope)}\u0000syncBatchStatus\u0000${batchStatusId}`;
}

export function syncBatchStatusRecordStorageKey(record: SyncBatchStatusRecord): string {
  return `${record.documentScopeKey}\u0000syncBatchStatus\u0000${record.batchStatusId}`;
}

export function normalizeSyncBatchStatusRecord(value: unknown): SyncBatchStatusRecord | null {
  if (!isSyncBatchStatusRecordShape(value)) return null;
  const { pendingBacklogSemantics: _ignored, ...record } = cloneJson(value) as Omit<
    SyncBatchStatusRecord,
    'pendingBacklogSemantics'
  > & {
    readonly pendingBacklogSemantics?: SyncBatchStatusPendingBacklogSemantics;
  };
  return cloneSyncBatchStatusRecord({
    ...record,
    pendingBacklogSemantics: syncBatchStatusPendingBacklogSemanticsForRecord(record),
  });
}

export function isSyncBatchStatusRecord(value: unknown): value is SyncBatchStatusRecord {
  if (!isSyncBatchStatusRecordShape(value)) return false;
  return (
    isSyncBatchStatusPendingBacklogSemantics(value.pendingBacklogSemantics) &&
    syncBatchStatusPendingBacklogSemanticsEqual(
      value.pendingBacklogSemantics,
      syncBatchStatusPendingBacklogSemanticsForRecord(value),
    )
  );
}

export function syncBatchCompletionIdentityConflicts(
  record: SyncBatchStatusRecord,
  input: CompleteSyncBatchStatusInput,
): boolean {
  if (record.identity.payloadHash !== input.payloadHash) return true;
  if (
    input.orderedSubUpdatePayloadHashes !== undefined &&
    canonicalJsonStringify(record.identity.orderedSubUpdatePayloadHashes ?? []) !==
      canonicalJsonStringify(input.orderedSubUpdatePayloadHashes)
  ) {
    return true;
  }
  if (
    input.subUpdateCount !== undefined &&
    (record.identity.subUpdateCount ?? 0) !== input.subUpdateCount
  ) {
    return true;
  }
  return false;
}

function isSyncBatchStatusRecordShape(value: unknown): value is Omit<
  SyncBatchStatusRecord,
  'pendingBacklogSemantics'
> & {
  readonly pendingBacklogSemantics?: unknown;
} {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (value.recordKind !== 'syncBatchStatus') return false;
  if (
    typeof value.batchStatusId !== 'string' ||
    !/^sync-batch-status:sha256:[0-9a-f]{64}$/.test(value.batchStatusId)
  ) {
    return false;
  }
  if (typeof value.documentScopeKey !== 'string') return false;
  if (typeof value.sourceKind !== 'string') return false;
  if (!isSyncBatchStatusIdentity(value.identity)) return false;
  if (!isSyncBatchOperationContext(value.operationContext)) return false;
  if (!syncBatchStatusIdentityMatchesOperationContext(value.identity, value.operationContext)) {
    return false;
  }
  if (!isSanitizedSyncBatchStatusCollaboration(value.operationContext.collaboration)) return false;
  if (!isSyncBatchStatusState(value.state)) return false;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false;
  if (value.state === 'pending') return value.terminal === undefined;
  if (!isSyncBatchStatusTerminal(value.terminal)) return false;
  return value.terminal.status === value.state;
}

function isSyncBatchStatusPendingBacklogSemantics(
  value: unknown,
): value is SyncBatchStatusPendingBacklogSemantics {
  if (!isRecord(value)) return false;
  return (
    typeof value.pendingForCheckout === 'boolean' &&
    typeof value.backlogForAdmission === 'boolean' &&
    isSyncBatchStatusPendingBacklogReason(value.reason)
  );
}

function isSyncBatchStatusPendingBacklogReason(
  value: unknown,
): value is SyncBatchStatusPendingBacklogReason {
  return (
    value === 'pending' ||
    value === 'complete' ||
    value === 'failedAfterMutation' ||
    value === 'terminalDropped' ||
    value === 'terminalRejected' ||
    value === 'blockedBatchFailure' ||
    value === 'missing' ||
    value === 'reservationConflict' ||
    value === 'reservationFailure' ||
    value === 'providerFailure'
  );
}

function syncBatchStatusPendingBacklogSemanticsEqual(
  left: SyncBatchStatusPendingBacklogSemantics,
  right: SyncBatchStatusPendingBacklogSemantics,
): boolean {
  return (
    left.pendingForCheckout === right.pendingForCheckout &&
    left.backlogForAdmission === right.backlogForAdmission &&
    left.reason === right.reason
  );
}

function isBlockedBatchFailureRecord(
  record: Pick<SyncBatchStatusRecord, 'operationContext'>,
): boolean {
  const collaboration = record.operationContext.collaboration;
  return (
    collaboration.commitGrouping === 'blockedBatchFailure' ||
    collaboration.exclusionSubreason === 'blockedBatchFailure'
  );
}

function isSyncBatchStatusState(value: unknown): value is SyncBatchStatusState {
  return (
    value === 'pending' ||
    value === 'complete' ||
    value === 'failedAfterMutation' ||
    value === 'dropped' ||
    value === 'rejected'
  );
}

function isSyncBatchStatusTerminal(value: unknown): value is SyncBatchStatusTerminal {
  if (!isRecord(value)) return false;
  if (value.status === 'complete') {
    return value.diagnosticDigest === undefined || isObjectDigest(value.diagnosticDigest);
  }
  if (
    value.status === 'failedAfterMutation' ||
    value.status === 'dropped' ||
    value.status === 'rejected'
  ) {
    return (
      typeof value.reason === 'string' &&
      (value.diagnosticDigest === undefined || isObjectDigest(value.diagnosticDigest))
    );
  }
  return false;
}

function syncBatchStatusReservationIdentity(record: SyncBatchStatusRecord) {
  return {
    schemaVersion: record.schemaVersion,
    recordKind: record.recordKind,
    batchStatusId: record.batchStatusId,
    documentScopeKey: record.documentScopeKey,
    identity: record.identity,
  };
}
