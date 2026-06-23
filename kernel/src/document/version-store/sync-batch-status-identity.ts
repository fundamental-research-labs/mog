import type {
  VersionOperationContext,
  VersionSyncOperationContext,
} from '@mog-sdk/contracts/versioning';

import { objectDigestFor } from './merge-apply-intent-store';
import {
  cloneJson,
  isRecord,
  optionalNonNegativeInteger,
  optionalStringArray,
} from './sync-batch-status-json';
import type {
  SyncBatchStatusIdentity,
  SyncBatchStatusIdentityInput,
  SyncBatchStatusKeyMaterial,
  SyncBatchStatusOperationContext,
} from './sync-batch-status-store';

type SyncBatchStatusHighWaterIdentity = Omit<SyncBatchStatusIdentity, 'payloadHash'>;

export function syncBatchStatusIdentityForOperationContext(
  operationContext: VersionOperationContext,
  input: SyncBatchStatusIdentityInput = {},
): SyncBatchStatusIdentity {
  const collaboration = syncBatchOperationContext(operationContext);
  const batchId = input.batchId ?? collaboration.updateId;
  if (
    !collaboration.stableOriginId ||
    !collaboration.epoch ||
    !batchId ||
    !collaboration.payloadHash
  ) {
    throw new Error(
      'Sync batch status identity requires stable origin id, epoch, batch id, and payload hash.',
    );
  }

  const normalizedSubUpdates = normalizeSubUpdateIdentity(input);
  return {
    schemaVersion: 1,
    originKind: collaboration.originKind,
    stableOriginId: collaboration.stableOriginId,
    epoch: collaboration.epoch,
    batchId,
    payloadHash: collaboration.payloadHash,
    ...(normalizedSubUpdates.orderedSubUpdatePayloadHashes === undefined
      ? {}
      : { orderedSubUpdatePayloadHashes: normalizedSubUpdates.orderedSubUpdatePayloadHashes }),
    ...(normalizedSubUpdates.subUpdateCount === undefined
      ? {}
      : { subUpdateCount: normalizedSubUpdates.subUpdateCount }),
  };
}

export async function syncBatchStatusKeyMaterialForOperationContext(
  operationContext: VersionOperationContext,
  input: SyncBatchStatusIdentityInput = {},
): Promise<SyncBatchStatusKeyMaterial> {
  const identity = syncBatchStatusIdentityForOperationContext(operationContext, input);
  const digest = await objectDigestFor(
    'mog.version.sync-batch-status.high-water-identity.v1',
    syncBatchStatusHighWaterIdentity(identity),
  );
  return {
    identity,
    batchStatusId: `sync-batch-status:sha256:${digest.digest}`,
  };
}

export function syncBatchOperationContext(
  operationContext: VersionOperationContext,
): SyncBatchStatusOperationContext['collaboration'] {
  if (!operationContext.collaboration) {
    throw new Error('Sync batch status operation context must include collaboration.');
  }
  return operationContext.collaboration;
}

export function sanitizeSyncBatchStatusOperationContext(
  operationContext: SyncBatchStatusOperationContext,
): SyncBatchStatusOperationContext {
  const collaboration = operationContext.collaboration;
  return cloneJson({
    ...operationContext,
    collaboration: {
      sourceKind: collaboration.sourceKind,
      originKind: collaboration.originKind,
      payloadHash: collaboration.payloadHash,
      trustStatus: collaboration.trustStatus,
      authorState: collaboration.authorState,
      replay: collaboration.replay,
      system: collaboration.system,
      commitGrouping: collaboration.commitGrouping,
      validationDiagnosticCount: collaboration.validationDiagnosticCount,
      ...(collaboration.stableOriginId === undefined
        ? {}
        : { stableOriginId: collaboration.stableOriginId }),
      ...(collaboration.epoch === undefined ? {} : { epoch: collaboration.epoch }),
      ...(collaboration.updateId === undefined ? {} : { updateId: collaboration.updateId }),
      ...(collaboration.roomId === undefined ? {} : { roomId: collaboration.roomId }),
      ...(collaboration.sequence === undefined ? {} : { sequence: collaboration.sequence }),
      ...(collaboration.provenancePayloadHash === undefined
        ? {}
        : { provenancePayloadHash: collaboration.provenancePayloadHash }),
      ...(collaboration.batchId === undefined ? {} : { batchId: collaboration.batchId }),
      ...(collaboration.subUpdateIndex === undefined
        ? {}
        : { subUpdateIndex: collaboration.subUpdateIndex }),
      ...(collaboration.subUpdateCount === undefined
        ? {}
        : { subUpdateCount: collaboration.subUpdateCount }),
      ...(collaboration.batchStatusId === undefined
        ? {}
        : { batchStatusId: collaboration.batchStatusId }),
      ...(collaboration.batchStatusState === undefined
        ? {}
        : { batchStatusState: collaboration.batchStatusState }),
      ...(collaboration.exclusionReason === undefined
        ? {}
        : { exclusionReason: collaboration.exclusionReason }),
      ...(collaboration.exclusionSubreason === undefined
        ? {}
        : { exclusionSubreason: collaboration.exclusionSubreason }),
    },
  });
}

export function syncBatchStatusIdentityMatchesOperationContext(
  identity: SyncBatchStatusIdentity,
  operationContext: SyncBatchStatusOperationContext,
): boolean {
  const collaboration = operationContext.collaboration;
  const batchId = collaboration.batchId ?? identity.batchId;
  return (
    identity.originKind === collaboration.originKind &&
    identity.stableOriginId === collaboration.stableOriginId &&
    identity.epoch === collaboration.epoch &&
    identity.batchId === batchId &&
    identity.payloadHash === collaboration.payloadHash
  );
}

export function isSanitizedSyncBatchStatusCollaboration(
  collaboration: VersionSyncOperationContext,
): boolean {
  return (
    collaboration.providerId === undefined &&
    collaboration.providerKind === undefined &&
    collaboration.authorityRef === undefined &&
    collaboration.remoteSessionId === undefined &&
    collaboration.correlationId === undefined &&
    collaboration.causationIds === undefined
  );
}

export function isSyncBatchStatusIdentity(value: unknown): value is SyncBatchStatusIdentity {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  return (
    typeof value.originKind === 'string' &&
    typeof value.stableOriginId === 'string' &&
    typeof value.epoch === 'string' &&
    typeof value.batchId === 'string' &&
    typeof value.payloadHash === 'string' &&
    optionalStringArray(value.orderedSubUpdatePayloadHashes) &&
    optionalNonNegativeInteger(value.subUpdateCount)
  );
}

export function isSyncBatchOperationContext(
  value: unknown,
): value is SyncBatchStatusOperationContext {
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

function syncBatchStatusHighWaterIdentity(
  identity: SyncBatchStatusIdentity,
): SyncBatchStatusHighWaterIdentity {
  return {
    schemaVersion: identity.schemaVersion,
    originKind: identity.originKind,
    stableOriginId: identity.stableOriginId,
    epoch: identity.epoch,
    batchId: identity.batchId,
    ...(identity.orderedSubUpdatePayloadHashes === undefined
      ? {}
      : { orderedSubUpdatePayloadHashes: identity.orderedSubUpdatePayloadHashes }),
    ...(identity.subUpdateCount === undefined ? {} : { subUpdateCount: identity.subUpdateCount }),
  };
}

function normalizeSubUpdateIdentity(input: SyncBatchStatusIdentityInput): {
  readonly orderedSubUpdatePayloadHashes?: readonly string[];
  readonly subUpdateCount?: number;
} {
  const ordered =
    input.orderedSubUpdatePayloadHashes === undefined
      ? undefined
      : [...input.orderedSubUpdatePayloadHashes];
  if (
    ordered !== undefined &&
    !ordered.every((hash) => typeof hash === 'string' && hash.length > 0)
  ) {
    throw new Error('Sync batch status sub-update hashes must be non-empty strings.');
  }
  if (
    input.subUpdateCount !== undefined &&
    (!Number.isInteger(input.subUpdateCount) || input.subUpdateCount < 0)
  ) {
    throw new Error('Sync batch status sub-update count must be a non-negative integer.');
  }
  if (
    ordered !== undefined &&
    input.subUpdateCount !== undefined &&
    ordered.length !== input.subUpdateCount
  ) {
    throw new Error('Sync batch status sub-update count must match ordered sub-update hashes.');
  }
  return {
    ...(ordered === undefined ? {} : { orderedSubUpdatePayloadHashes: Object.freeze(ordered) }),
    ...(input.subUpdateCount === undefined && ordered === undefined
      ? {}
      : { subUpdateCount: input.subUpdateCount ?? ordered?.length ?? 0 }),
  };
}
