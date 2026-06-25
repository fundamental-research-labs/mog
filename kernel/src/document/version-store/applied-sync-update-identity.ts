import type {
  VersionOperationContext,
  VersionSyncOperationContext,
} from '@mog-sdk/contracts/versioning';

import { objectDigestFor } from './merge-apply-intent-store';
import { cloneJson, isRecord } from './sync-batch-status-json';
import type {
  AppliedSyncUpdateIdentity,
  AppliedSyncUpdateIdentityKeyMaterial,
  AppliedSyncUpdateIdentityOperationContext,
} from './applied-sync-update-identity-store';

export function appliedSyncUpdateIdentityForOperationContext(
  operationContext: VersionOperationContext,
): AppliedSyncUpdateIdentity {
  const collaboration = appliedSyncOperationContext(operationContext);
  if (collaboration.originKind !== 'provider' && collaboration.originKind !== 'room') {
    throw new Error('Applied sync update identity requires provider or room origin.');
  }
  if (
    !collaboration.stableOriginId ||
    !collaboration.epoch ||
    !collaboration.updateId ||
    !collaboration.payloadHash
  ) {
    throw new Error(
      'Applied sync update identity requires stable origin, epoch, update id, and payload hash.',
    );
  }
  return {
    schemaVersion: 1,
    originKind: collaboration.originKind,
    stableOriginId: collaboration.stableOriginId,
    epoch: collaboration.epoch,
    updateId: collaboration.updateId,
  };
}

export async function appliedSyncUpdateIdentityKeyMaterialForOperationContext(
  operationContext: VersionOperationContext,
): Promise<AppliedSyncUpdateIdentityKeyMaterial> {
  const identity = appliedSyncUpdateIdentityForOperationContext(operationContext);
  const digest = await objectDigestFor('mog.version.applied-sync-update.identity.v1', identity);
  return {
    identity,
    identityKey: `applied-sync-update:sha256:${digest.digest}`,
  };
}

export function appliedSyncOperationContext(
  operationContext: VersionOperationContext,
): AppliedSyncUpdateIdentityOperationContext['collaboration'] {
  if (!operationContext.collaboration) {
    throw new Error('Applied sync update identity operation context must include collaboration.');
  }
  return operationContext.collaboration;
}

export function isAppliedSyncUpdateIdentity(value: unknown): value is AppliedSyncUpdateIdentity {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    (value.originKind === 'provider' || value.originKind === 'room') &&
    typeof value.stableOriginId === 'string' &&
    typeof value.epoch === 'string' &&
    typeof value.updateId === 'string'
  );
}

export function isAppliedSyncOperationContext(
  value: unknown,
): value is AppliedSyncUpdateIdentityOperationContext {
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
    (value.collaboration.originKind === 'provider' || value.collaboration.originKind === 'room') &&
    typeof value.collaboration.stableOriginId === 'string' &&
    typeof value.collaboration.epoch === 'string' &&
    typeof value.collaboration.updateId === 'string' &&
    typeof value.collaboration.payloadHash === 'string'
  );
}

export function sanitizeAppliedSyncUpdateIdentityOperationContext(
  operationContext: AppliedSyncUpdateIdentityOperationContext,
): AppliedSyncUpdateIdentityOperationContext {
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

export function isSanitizedAppliedSyncUpdateCollaboration(
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
