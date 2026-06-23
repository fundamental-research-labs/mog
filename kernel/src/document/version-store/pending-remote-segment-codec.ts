import { isObjectDigest } from './object-digest';
import { versionGraphNamespaceKey, type VersionGraphNamespace } from './object-store';
import { pendingRemoteSegmentKeyMaterialForOperationContext } from './pending-remote-segment-keys';
import type {
  PendingRemoteSegmentIdempotencyKey,
  PendingRemoteSegmentOperationContext,
  PendingRemoteSegmentRecord,
  PendingRemoteSegmentReservationRecordOptions,
  PendingRemoteSegmentSyncIdentity,
  PendingRemoteSegmentTerminal,
} from './pending-remote-segment-types';

export async function pendingRemoteSegmentReservationRecord(
  options: PendingRemoteSegmentReservationRecordOptions,
): Promise<PendingRemoteSegmentRecord> {
  const keyMaterial = await pendingRemoteSegmentKeyMaterialForOperationContext(
    options.input.operationContext,
  );
  if (
    options.input.idempotencyKey !== keyMaterial.idempotencyKey ||
    options.input.pendingRemoteSegmentId !== keyMaterial.pendingRemoteSegmentId
  ) {
    throw new Error('Pending remote segment key material does not match collaboration identity.');
  }

  return clonePendingRemoteSegmentRecord({
    ...options.input,
    schemaVersion: 1,
    recordKind: 'pendingRemoteSegment',
    pendingRemoteSegmentId: keyMaterial.pendingRemoteSegmentId,
    idempotencyKey: keyMaterial.idempotencyKey,
    namespaceKey: options.namespaceKey,
    documentScopeKey: options.documentScopeKey,
    syncIdentity: keyMaterial.syncIdentity,
    state: 'pending',
    updatedAt: options.input.createdAt,
  });
}

export function clonePendingRemoteSegmentRecord(
  record: PendingRemoteSegmentRecord,
): PendingRemoteSegmentRecord;
export function clonePendingRemoteSegmentRecord(record: undefined): undefined;
export function clonePendingRemoteSegmentRecord(
  record: PendingRemoteSegmentRecord | undefined,
): PendingRemoteSegmentRecord | undefined;
export function clonePendingRemoteSegmentRecord(
  record: PendingRemoteSegmentRecord | undefined,
): PendingRemoteSegmentRecord | undefined {
  return record === undefined ? undefined : cloneJson(record);
}

export function pendingRemoteSegmentsEquivalent(
  left: PendingRemoteSegmentRecord,
  right: PendingRemoteSegmentRecord,
): boolean {
  return (
    canonicalJsonStringify(pendingRemoteSegmentReservationIdentity(left)) ===
    canonicalJsonStringify(pendingRemoteSegmentReservationIdentity(right))
  );
}

export function pendingRemoteSegmentTerminalsEqual(
  left: PendingRemoteSegmentTerminal,
  right: PendingRemoteSegmentTerminal,
): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

export function pendingRemoteSegmentStorageKey(
  namespace: VersionGraphNamespace,
  idempotencyKey: PendingRemoteSegmentIdempotencyKey,
): string {
  return `${versionGraphNamespaceKey(namespace)}\u0000pendingRemote\u0000${idempotencyKey}`;
}

export function pendingRemoteSegmentStorageKeyFromRecord(
  record: PendingRemoteSegmentRecord,
): string {
  return `${record.namespaceKey}\u0000pendingRemote\u0000${record.idempotencyKey}`;
}

export function isPendingRemoteSegmentRecord(value: unknown): value is PendingRemoteSegmentRecord {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (value.recordKind !== 'pendingRemoteSegment') return false;
  if (
    typeof value.pendingRemoteSegmentId !== 'string' ||
    !/^pending-remote-segment:sha256:[0-9a-f]{64}$/.test(value.pendingRemoteSegmentId)
  ) {
    return false;
  }
  if (
    typeof value.idempotencyKey !== 'string' ||
    !/^pending-remote:sha256:[0-9a-f]{64}$/.test(value.idempotencyKey)
  ) {
    return false;
  }
  if (typeof value.namespaceKey !== 'string' || typeof value.documentScopeKey !== 'string') {
    return false;
  }
  if (value.state !== 'pending' && value.state !== 'promoted' && value.state !== 'dropped') {
    return false;
  }
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false;
  if (!isPendingRemoteSyncIdentity(value.syncIdentity)) return false;
  if (!isPendingRemoteOperationContext(value.operationContext)) return false;
  if (!isObjectDigest(value.mutationSegmentDigest)) return false;
  if (value.snapshotRootDigest !== undefined && !isObjectDigest(value.snapshotRootDigest)) {
    return false;
  }
  if (
    value.semanticChangeSetDigest !== undefined &&
    !isObjectDigest(value.semanticChangeSetDigest)
  ) {
    return false;
  }
  if (value.state === 'pending') return value.terminal === undefined;
  if (!isPendingRemoteTerminal(value.terminal)) return false;
  if (value.terminal.status !== value.state) return false;
  return true;
}

export function comparePendingRemoteSegmentRecords(
  left: PendingRemoteSegmentRecord,
  right: PendingRemoteSegmentRecord,
): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.pendingRemoteSegmentId.localeCompare(right.pendingRemoteSegmentId)
  );
}

function pendingRemoteSegmentReservationIdentity(record: PendingRemoteSegmentRecord) {
  return {
    schemaVersion: record.schemaVersion,
    recordKind: record.recordKind,
    pendingRemoteSegmentId: record.pendingRemoteSegmentId,
    idempotencyKey: record.idempotencyKey,
    namespaceKey: record.namespaceKey,
    documentScopeKey: record.documentScopeKey,
    syncIdentity: record.syncIdentity,
    operationContext: stableOperationContextIdentity(record.operationContext),
    mutationSegmentDigest: record.mutationSegmentDigest,
    snapshotRootDigest: record.snapshotRootDigest,
    semanticChangeSetDigest: record.semanticChangeSetDigest,
  };
}

function stableOperationContextIdentity(context: PendingRemoteSegmentOperationContext) {
  return {
    operationId: context.operationId,
    kind: context.kind,
    author: context.author,
    workbookId: context.workbookId,
    sheetIds: context.sheetIds,
    domainIds: context.domainIds,
    groupId: context.groupId,
    capturePolicy: context.capturePolicy,
    writeAdmissionMode: context.writeAdmissionMode,
    rolloutStage: context.rolloutStage,
    capabilityGate: context.capabilityGate,
    clientRequestId: context.clientRequestId,
    collaboration: context.collaboration,
  };
}

function isPendingRemoteSyncIdentity(value: unknown): value is PendingRemoteSegmentSyncIdentity {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  return (
    typeof value.sourceKind === 'string' &&
    typeof value.originKind === 'string' &&
    optionalString(value.stableOriginId) &&
    optionalString(value.providerId) &&
    optionalString(value.authorityRef) &&
    optionalString(value.roomId) &&
    optionalString(value.epoch) &&
    optionalString(value.updateId) &&
    optionalString(value.sequence) &&
    typeof value.payloadHash === 'string' &&
    value.payloadHash.length > 0
  );
}

function isPendingRemoteOperationContext(
  value: unknown,
): value is PendingRemoteSegmentOperationContext {
  if (!isRecord(value) || !isRecord(value.collaboration)) return false;
  return (
    typeof value.operationId === 'string' &&
    typeof value.kind === 'string' &&
    isRecord(value.author) &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.domainIds) &&
    typeof value.capturePolicy === 'string' &&
    typeof value.writeAdmissionMode === 'string' &&
    typeof value.collaboration.sourceKind === 'string' &&
    typeof value.collaboration.originKind === 'string' &&
    typeof value.collaboration.payloadHash === 'string'
  );
}

function isPendingRemoteTerminal(value: unknown): value is PendingRemoteSegmentTerminal {
  if (!isRecord(value)) return false;
  if (value.status === 'promoted') {
    return (
      optionalString(value.commitId) &&
      (value.promotionDigest === undefined || isObjectDigest(value.promotionDigest))
    );
  }
  if (value.status === 'dropped') {
    return (
      typeof value.reason === 'string' &&
      (value.diagnosticDigest === undefined || isObjectDigest(value.diagnosticDigest))
    );
  }
  return false;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON number must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonStringify).join(',')}]`;
  if (!isRecord(value)) throw new Error('value must be canonical JSON');
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(value[key])}`)
    .join(',')}}`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
