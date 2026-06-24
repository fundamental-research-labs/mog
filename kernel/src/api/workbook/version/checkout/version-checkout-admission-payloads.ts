import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import type {
  LiveCollaborationPayload,
  PendingProviderWriteNumberPayload,
  PendingProviderWritePayload,
  PendingProviderWriteStringPayload,
  VersionCheckoutAdmissionBlock,
} from './version-checkout-admission-types';

export function unsafeReasonCode(
  dirty: { readonly unsafeReasons: readonly VersionDiagnostic[] },
  code: string,
): boolean {
  return dirty.unsafeReasons.some((reason) => reason.code === code);
}

export function pendingProviderWritePayload(
  unsafeReasons: readonly VersionDiagnostic[],
): Pick<
  Extract<VersionCheckoutAdmissionBlock, { reason: 'pendingProviderWrites' }>,
  | 'pendingRemoteSegmentCount'
  | 'remoteSyncApplyActiveCount'
  | 'pendingRemotePromotionActiveCount'
  | 'pendingRemotePromotionQueuedCount'
  | 'syncBatchStatusPendingCount'
  | 'syncBatchStatusBlockedCount'
  | 'syncBatchStatusTerminalCount'
  | 'syncBatchStatusFailedAfterMutationCount'
  | 'syncBatchStatusDroppedCount'
  | 'syncBatchStatusRejectedCount'
  | 'syncBatchStatusReadFailedCount'
  | 'syncBatchStatusFirstState'
  | 'syncBatchStatusFirstReason'
  | 'syncBatchStatusFirstSegmentId'
  | 'syncBatchStatusFirstBatchStatusId'
> {
  const payload: PendingProviderWritePayload = {};
  for (const reason of unsafeReasons) {
    if (reason.code !== 'version.surfaceStatus.pendingProviderWrites') continue;
    assignNumberPayload(payload, 'pendingRemoteSegmentCount', reason.data);
    assignNumberPayload(payload, 'remoteSyncApplyActiveCount', reason.data);
    assignNumberPayload(payload, 'pendingRemotePromotionActiveCount', reason.data);
    assignNumberPayload(payload, 'pendingRemotePromotionQueuedCount', reason.data);
    assignNumberPayload(payload, 'syncBatchStatusPendingCount', reason.data);
    assignNumberPayload(payload, 'syncBatchStatusBlockedCount', reason.data);
    assignNumberPayload(payload, 'syncBatchStatusTerminalCount', reason.data);
    assignNumberPayload(payload, 'syncBatchStatusFailedAfterMutationCount', reason.data);
    assignNumberPayload(payload, 'syncBatchStatusDroppedCount', reason.data);
    assignNumberPayload(payload, 'syncBatchStatusRejectedCount', reason.data);
    assignNumberPayload(payload, 'syncBatchStatusReadFailedCount', reason.data);
    assignStringPayload(payload, 'syncBatchStatusFirstState', reason.data);
    assignStringPayload(payload, 'syncBatchStatusFirstReason', reason.data);
    assignStringPayload(payload, 'syncBatchStatusFirstSegmentId', reason.data);
    assignStringPayload(payload, 'syncBatchStatusFirstBatchStatusId', reason.data);
  }
  return payload;
}

export function liveCollaborationPayload(
  unsafeReasons: readonly VersionDiagnostic[],
): LiveCollaborationPayload {
  const payload: LiveCollaborationPayload = {};
  for (const reason of unsafeReasons) {
    if (
      reason.code !== 'version.surfaceStatus.liveCollaborationActive' &&
      reason.code !== 'version.surfaceStatus.liveCollaborationUnknown'
    ) {
      continue;
    }
    assignStringPayload(payload, 'collaborationState', reason.data);
    assignStringPayload(payload, 'roomId', reason.data);
    assignStringPayload(payload, 'sidecarStatus', reason.data);
    assignNumberPayload(payload, 'activeParticipantCount', reason.data);
    assignBooleanPayload(payload, 'remoteProviderAttached', reason.data);
    assignNumberPayload(payload, 'inFlightRemoteUpdateCount', reason.data);
    assignNumberPayload(payload, 'syncApplyRemoteQueueDepth', reason.data);
  }
  return payload;
}

function assignNumberPayload(
  payload: PendingProviderWriteNumberPayload | LiveCollaborationPayload,
  key: keyof PendingProviderWriteNumberPayload | keyof LiveCollaborationPayload,
  data: VersionDiagnostic['data'],
): void {
  const value = data?.[key];
  if (typeof value === 'number') {
    (payload as Record<string, number>)[key] = value;
  }
}

function assignStringPayload(
  payload: LiveCollaborationPayload | PendingProviderWriteStringPayload,
  key: keyof LiveCollaborationPayload | keyof PendingProviderWriteStringPayload,
  data: VersionDiagnostic['data'],
): void {
  const value = data?.[key];
  if (typeof value === 'string') {
    (payload as Record<string, string>)[key] = value;
  }
}

function assignBooleanPayload(
  payload: LiveCollaborationPayload,
  key: keyof LiveCollaborationPayload,
  data: VersionDiagnostic['data'],
): void {
  const value = data?.[key];
  if (typeof value === 'boolean') {
    (payload as Record<string, boolean>)[key] = value;
  }
}
