import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import { objectDigestFor } from './merge-apply-intent-store';
import type {
  PendingRemoteSegmentId,
  PendingRemoteSegmentIdempotencyKey,
  PendingRemoteSegmentKeyMaterial,
  PendingRemoteSegmentSyncIdentity,
} from './pending-remote-segment-types';

export function pendingRemoteSegmentIdentityForOperationContext(
  operationContext: VersionOperationContext,
): PendingRemoteSegmentSyncIdentity {
  const collaboration = operationContext.collaboration;
  if (!collaboration) {
    throw new Error('Pending remote segment operation context must include collaboration.');
  }
  return {
    schemaVersion: 1,
    sourceKind: collaboration.sourceKind,
    originKind: collaboration.originKind,
    ...(collaboration.stableOriginId === undefined
      ? {}
      : { stableOriginId: collaboration.stableOriginId }),
    ...(collaboration.providerId === undefined ? {} : { providerId: collaboration.providerId }),
    ...(collaboration.authorityRef === undefined
      ? {}
      : { authorityRef: collaboration.authorityRef }),
    ...(collaboration.roomId === undefined ? {} : { roomId: collaboration.roomId }),
    ...(collaboration.epoch === undefined ? {} : { epoch: collaboration.epoch }),
    ...(collaboration.updateId === undefined ? {} : { updateId: collaboration.updateId }),
    ...(collaboration.sequence === undefined ? {} : { sequence: collaboration.sequence }),
    payloadHash: collaboration.payloadHash,
  };
}

export async function pendingRemoteSegmentKeyMaterialForOperationContext(
  operationContext: VersionOperationContext,
): Promise<PendingRemoteSegmentKeyMaterial> {
  const syncIdentity = pendingRemoteSegmentIdentityForOperationContext(operationContext);
  const digest = await objectDigestFor(
    'mog.version.pending-remote-segment.identity.v1',
    syncIdentity,
  );
  return {
    syncIdentity,
    idempotencyKey: `pending-remote:sha256:${digest.digest}`,
    pendingRemoteSegmentId: `pending-remote-segment:sha256:${digest.digest}`,
  };
}

export async function idempotencyKeyForPendingRemoteSegment(
  operationContext: VersionOperationContext,
): Promise<PendingRemoteSegmentIdempotencyKey> {
  return (await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext))
    .idempotencyKey;
}

export async function pendingRemoteSegmentIdForOperationContext(
  operationContext: VersionOperationContext,
): Promise<PendingRemoteSegmentId> {
  return (await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext))
    .pendingRemoteSegmentId;
}
