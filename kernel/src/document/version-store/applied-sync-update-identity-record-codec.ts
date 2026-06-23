import { isObjectDigest } from './object-digest';
import { versionDocumentScopeKey, type VersionDocumentScope } from './registry';
import {
  appliedSyncOperationContext,
  appliedSyncUpdateIdentityForOperationContext,
  appliedSyncUpdateIdentityKeyMaterialForOperationContext,
  isAppliedSyncOperationContext,
  isAppliedSyncUpdateIdentity,
  isSanitizedAppliedSyncUpdateCollaboration,
  sanitizeAppliedSyncUpdateIdentityOperationContext,
} from './applied-sync-update-identity';
import { cloneJson, isRecord } from './sync-batch-status-json';
import type {
  AppliedSyncUpdateIdentityKey,
  AppliedSyncUpdateIdentityRecord,
  AppliedSyncUpdateIdentityState,
  AppliedSyncUpdateIdentityTerminal,
  CompleteAppliedSyncUpdateIdentityInput,
  ReserveAppliedSyncUpdateIdentityInput,
} from './applied-sync-update-identity-store';

export async function appliedSyncUpdateIdentityRecordFromReserveInput(
  input: ReserveAppliedSyncUpdateIdentityInput,
  documentScopeKey: string,
): Promise<AppliedSyncUpdateIdentityRecord> {
  const collaboration = appliedSyncOperationContext(input.operationContext);
  const keyMaterial = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
    input.operationContext,
  );
  if (input.identityKey !== keyMaterial.identityKey) {
    throw new Error('Applied sync update identity key does not match operation context.');
  }
  return cloneAppliedSyncUpdateIdentityRecord({
    schemaVersion: 1,
    recordKind: 'appliedSyncUpdateIdentity',
    identityKey: input.identityKey,
    documentScopeKey,
    identity: keyMaterial.identity,
    payloadHash: collaboration.payloadHash,
    operationContext: sanitizeAppliedSyncUpdateIdentityOperationContext(input.operationContext),
    state: 'reserved',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function completeAppliedSyncUpdateIdentityRecord(
  existing: AppliedSyncUpdateIdentityRecord,
  input: CompleteAppliedSyncUpdateIdentityInput,
): AppliedSyncUpdateIdentityRecord {
  return {
    ...existing,
    state: input.terminal.status,
    updatedAt: input.completedAt,
    terminal: cloneJson(input.terminal),
  };
}

export function cloneAppliedSyncUpdateIdentityRecord(
  record: AppliedSyncUpdateIdentityRecord,
): AppliedSyncUpdateIdentityRecord;
export function cloneAppliedSyncUpdateIdentityRecord(record: undefined): undefined;
export function cloneAppliedSyncUpdateIdentityRecord(
  record: AppliedSyncUpdateIdentityRecord | undefined,
): AppliedSyncUpdateIdentityRecord | undefined;
export function cloneAppliedSyncUpdateIdentityRecord(
  record: AppliedSyncUpdateIdentityRecord | undefined,
): AppliedSyncUpdateIdentityRecord | undefined {
  if (record === undefined) return undefined;
  const cloned = cloneJson(record);
  return {
    ...cloned,
    operationContext: sanitizeAppliedSyncUpdateIdentityOperationContext(cloned.operationContext),
  };
}

export function appliedSyncUpdateIdentityReservationsEquivalent(
  left: AppliedSyncUpdateIdentityRecord,
  right: AppliedSyncUpdateIdentityRecord,
): boolean {
  return (
    canonicalJsonStringify(appliedSyncUpdateIdentityReservationIdentity(left)) ===
    canonicalJsonStringify(appliedSyncUpdateIdentityReservationIdentity(right))
  );
}

export function appliedSyncUpdateIdentityTerminalsEqual(
  left: AppliedSyncUpdateIdentityTerminal,
  right: AppliedSyncUpdateIdentityTerminal,
): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

export function appliedSyncUpdateIdentityStorageKey(
  documentScope: VersionDocumentScope,
  identityKey: AppliedSyncUpdateIdentityKey,
): string {
  return `${versionDocumentScopeKey(documentScope)}\u0000appliedSyncUpdate\u0000${identityKey}`;
}

export function appliedSyncUpdateIdentityRecordStorageKey(
  record: AppliedSyncUpdateIdentityRecord,
): string {
  return `${record.documentScopeKey}\u0000appliedSyncUpdate\u0000${record.identityKey}`;
}

export function isAppliedSyncUpdateIdentityRecord(
  value: unknown,
): value is AppliedSyncUpdateIdentityRecord {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (value.recordKind !== 'appliedSyncUpdateIdentity') return false;
  if (
    typeof value.identityKey !== 'string' ||
    !/^applied-sync-update:sha256:[0-9a-f]{64}$/.test(value.identityKey)
  ) {
    return false;
  }
  if (typeof value.documentScopeKey !== 'string') return false;
  const identity = value.identity;
  if (!isAppliedSyncUpdateIdentity(identity)) return false;
  if (typeof value.payloadHash !== 'string' || value.payloadHash.length === 0) return false;
  const operationContext = value.operationContext;
  if (!isAppliedSyncOperationContext(operationContext)) return false;
  if (operationContext.collaboration.payloadHash !== value.payloadHash) return false;
  try {
    if (
      canonicalJsonStringify(appliedSyncUpdateIdentityForOperationContext(operationContext)) !==
      canonicalJsonStringify(identity)
    ) {
      return false;
    }
  } catch {
    return false;
  }
  if (!isAppliedSyncUpdateIdentityState(value.state)) return false;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false;
  if (!isSanitizedAppliedSyncUpdateCollaboration(operationContext.collaboration)) return false;
  if (value.state === 'reserved') return value.terminal === undefined;
  if (!isAppliedSyncUpdateIdentityTerminal(value.terminal)) return false;
  return value.terminal.status === value.state;
}

function isAppliedSyncUpdateIdentityState(value: unknown): value is AppliedSyncUpdateIdentityState {
  return (
    value === 'reserved' ||
    value === 'applied' ||
    value === 'rejected' ||
    value === 'retryable' ||
    value === 'gapWaiting' ||
    value === 'failedAfterMutation'
  );
}

function isAppliedSyncUpdateIdentityTerminal(
  value: unknown,
): value is AppliedSyncUpdateIdentityTerminal {
  if (!isRecord(value)) return false;
  if (value.status === 'applied') {
    return (
      (value.pendingRemoteSegmentId === undefined ||
        typeof value.pendingRemoteSegmentId === 'string') &&
      (value.mutationSegmentDigest === undefined || isObjectDigest(value.mutationSegmentDigest))
    );
  }
  if (
    value.status === 'rejected' ||
    value.status === 'retryable' ||
    value.status === 'gapWaiting' ||
    value.status === 'failedAfterMutation'
  ) {
    return (
      typeof value.reason === 'string' &&
      (value.diagnosticDigest === undefined || isObjectDigest(value.diagnosticDigest))
    );
  }
  return false;
}

function appliedSyncUpdateIdentityReservationIdentity(record: AppliedSyncUpdateIdentityRecord) {
  return {
    schemaVersion: record.schemaVersion,
    recordKind: record.recordKind,
    identityKey: record.identityKey,
    documentScopeKey: record.documentScopeKey,
    identity: record.identity,
  };
}

function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child !== undefined) sorted[key] = sortJson(child);
  }
  return sorted;
}
