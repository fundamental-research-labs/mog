import {
  liveCollaborationPayload,
  pendingProviderWritePayload,
  unsafeReasonCode,
} from './version-checkout-admission-payloads';
import type {
  VersionCheckoutAdmissionBlock,
  VersionCheckoutAdmissionLease,
} from './version-checkout-admission-types';
import type {
  readCheckoutSessionCurrentStatus,
  readVersionSurfaceDirtyStatus,
} from '../surface-status/version-surface-status-service';

export function checkoutLeaseFromDirtyStatus(
  dirty: Awaited<ReturnType<typeof readVersionSurfaceDirtyStatus>>,
): VersionCheckoutAdmissionLease {
  return {
    statusRevision: dirty.statusRevision,
    checkoutPreflightToken: dirty.checkoutPreflightToken,
  };
}

export function checkoutAdmissionBlockForDirtyStatus(
  dirty: Awaited<ReturnType<typeof readVersionSurfaceDirtyStatus>>,
  options: { readonly ignoreCheckoutInProgress?: boolean } = {},
): VersionCheckoutAdmissionBlock | null {
  if (dirty.hasUncommittedLocalChanges) return { reason: 'dirtyWorkingState' };
  if (dirty.pendingProviderWrites) {
    return {
      reason: 'pendingProviderWrites',
      ...pendingProviderWritePayload(dirty.unsafeReasons),
    };
  }
  if (dirty.pendingRecalc) return { reason: 'pendingRecalc' };
  if (
    !options.ignoreCheckoutInProgress &&
    unsafeReasonCode(dirty, 'version.surfaceStatus.checkoutInProgress')
  ) {
    return { reason: 'checkoutAlreadyInProgress' };
  }
  if (
    unsafeReasonCode(dirty, 'version.surfaceStatus.liveCollaborationActive') ||
    unsafeReasonCode(dirty, 'version.surfaceStatus.liveCollaborationUnknown')
  ) {
    return {
      reason: 'liveCollaborationActive',
      ...liveCollaborationPayload(dirty.unsafeReasons),
    };
  }
  if (!dirty.checkoutSafe && !onlyIgnoredCheckoutInProgress(dirty, options)) {
    return { reason: 'checkoutPreflightUnsafe' };
  }
  return null;
}

function onlyIgnoredCheckoutInProgress(
  dirty: Awaited<ReturnType<typeof readVersionSurfaceDirtyStatus>>,
  options: { readonly ignoreCheckoutInProgress?: boolean },
): boolean {
  return Boolean(
    options.ignoreCheckoutInProgress &&
    dirty.unsafeReasons.length > 0 &&
    dirty.unsafeReasons.every(
      (reason) => reason.code === 'version.surfaceStatus.checkoutInProgress',
    ),
  );
}

export function checkoutLeaseMatchesDirtyStatus(
  lease: VersionCheckoutAdmissionLease,
  dirty: Awaited<ReturnType<typeof readVersionSurfaceDirtyStatus>>,
): boolean {
  if (dirty.statusRevision === lease.statusRevision) return true;
  return (
    normalizeCheckoutBusyRevision(dirty.statusRevision) === lease.statusRevision &&
    normalizeCheckoutBusyRevision(dirty.checkoutPreflightToken) === lease.checkoutPreflightToken
  );
}

function normalizeCheckoutBusyRevision(value: string): string {
  return value.replace('checkout:busy', 'checkout:idle');
}

export function staleWorkspaceHeadBlock(
  current: Awaited<ReturnType<typeof readCheckoutSessionCurrentStatus>>,
): VersionCheckoutAdmissionBlock {
  return {
    reason: 'staleWorkspaceHead',
    staleReason: current.staleReason ?? 'unknown',
    ...(current.branchName ? { branchName: current.branchName } : {}),
    ...(current.checkedOutCommitId ? { checkedOutCommitId: current.checkedOutCommitId } : {}),
    ...(current.refHeadAtMaterialization
      ? { refHeadAtMaterialization: current.refHeadAtMaterialization }
      : {}),
    ...(current.currentRefHeadId ? { currentRefHeadId: current.currentRefHeadId } : {}),
  };
}
