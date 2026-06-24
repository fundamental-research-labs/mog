import type { VersionCapability, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { validateVersionBranchCreationName } from '../version-branch-name';
import {
  actionSurfaceDisabledReason,
  checkoutUnsafeDisabledReason,
  commitDirtyDisabledReason,
  commonActionDisabledReason,
  currentStaleDisabledReason,
  dirtyStatusUnavailableDisabledReason,
  disabledAction,
  enabledAction,
  isCapabilityEnabled,
  providerWritesDiagnosticReason,
  providerWritesDisabledReason,
} from './version-action-availability-reasons';
import { sanitizeVersionStatusText } from './version-action-availability-sanitize';
import { DisabledReason, safeDomId } from './version-action-availability-ui';
import type {
  VersionActionAvailability,
  VersionActionSurfaceData,
} from './version-action-availability-types';

export { DisabledReason, isCapabilityEnabled, safeDomId, sanitizeVersionStatusText };
export type {
  VersionActionAvailability,
  VersionActionDisabledReasonId,
} from './version-action-availability-types';

export function getCommitAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
  commitMessage: string,
): VersionActionAvailability {
  if (!data) return disabledAction('version-status-unavailable', 'Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const surface = data.surface;
  if (!surface) {
    return disabledAction('version-surface-unavailable', 'Version surface status is unavailable.');
  }
  const surfaceReason = actionSurfaceDisabledReason(surface, 'version:commit');
  if (surfaceReason) return disabledAction(surfaceReason);

  const staleReason = currentStaleDisabledReason(surface, 'commit');
  if (staleReason) return disabledAction(staleReason);

  const dirtyStatusReason = dirtyStatusUnavailableDisabledReason(surface);
  if (dirtyStatusReason) return disabledAction(dirtyStatusReason);

  const dirtyReason = commitDirtyDisabledReason(surface);
  if (dirtyReason) return disabledAction(dirtyReason);

  if (commitMessage.trim().length === 0) {
    return disabledAction('version-commit-message-required', 'Enter a commit message.');
  }
  return enabledAction();
}

export function getBranchAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
  branchName: string,
  targetCommitId: WorkbookCommitId | undefined,
): VersionActionAvailability {
  if (!data) return disabledAction('version-status-unavailable', 'Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const surfaceReason = actionSurfaceDisabledReason(data.surface, 'version:branch');
  if (surfaceReason) return disabledAction(surfaceReason);

  if (!targetCommitId) {
    return disabledAction('version-target-required', 'Select a commit target first.');
  }
  const branchNameValidation = validateVersionBranchCreationName(branchName, data.refs ?? []);
  if (!branchNameValidation.ok) {
    return disabledAction('version-branch-name-invalid', branchNameValidation.reason);
  }
  return enabledAction();
}

export function getCheckoutAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
): VersionActionAvailability {
  if (!data) return disabledAction('version-status-unavailable', 'Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const surface = data.surface;
  if (!surface) {
    return disabledAction('version-surface-unavailable', 'Version surface status is unavailable.');
  }
  const surfaceReason = actionSurfaceDisabledReason(surface, 'version:checkout');
  if (surfaceReason) return disabledAction(surfaceReason);

  const staleReason = currentStaleDisabledReason(surface, 'checkout');
  if (staleReason) return disabledAction(staleReason);

  const dirtyStatusReason = dirtyStatusUnavailableDisabledReason(surface);
  if (dirtyStatusReason) return disabledAction(dirtyStatusReason);

  const providerWriteReason =
    providerWritesDiagnosticReason(surface) ??
    providerWritesDisabledReason(surface, 'checking out');
  if (providerWriteReason) return disabledAction(providerWriteReason);

  const checkoutReason = checkoutUnsafeDisabledReason(surface);
  if (checkoutReason) return disabledAction(checkoutReason);

  return enabledAction();
}

export function getDiffAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
): VersionActionAvailability {
  if (!data) return disabledAction('version-status-unavailable', 'Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const surfaceReason = actionSurfaceDisabledReason(data.surface, 'version:diff');
  if (surfaceReason) return disabledAction(surfaceReason);
  return enabledAction();
}

export function getRollbackAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
  rollbackReason: string,
  targetCommitId: WorkbookCommitId | undefined,
): VersionActionAvailability {
  if (!data) return disabledAction('version-status-unavailable', 'Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const surface = data.surface;
  if (!surface) {
    return disabledAction('version-surface-unavailable', 'Version surface status is unavailable.');
  }
  const surfaceReason = actionSurfaceDisabledReason(surface, 'version:revert');
  if (surfaceReason) return disabledAction(surfaceReason);

  const staleReason = currentStaleDisabledReason(surface, 'rollback');
  if (staleReason) return disabledAction(staleReason);

  const dirtyStatusReason = dirtyStatusUnavailableDisabledReason(surface);
  if (dirtyStatusReason) return disabledAction(dirtyStatusReason);

  const providerWriteReason =
    providerWritesDiagnosticReason(surface) ??
    providerWritesDisabledReason(surface, 'staging rollback');
  if (providerWriteReason) return disabledAction(providerWriteReason);

  if (!targetCommitId) {
    return disabledAction('version-target-required', 'Select a commit target first.');
  }
  if (rollbackReason.trim().length === 0) {
    return disabledAction('version-rollback-reason-required', 'Enter a rollback reason.');
  }
  return enabledAction();
}

export function getRemotePromoteAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
): VersionActionAvailability {
  if (!data) return disabledAction('version-status-unavailable', 'Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const surfaceReason = actionSurfaceDisabledReason(data.surface, 'version:remotePromote');
  if (surfaceReason) return disabledAction(surfaceReason);
  return enabledAction();
}

export function getCapabilityAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
  capability: VersionCapability,
): VersionActionAvailability {
  if (!data) return disabledAction('version-status-unavailable', 'Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const surfaceReason = actionSurfaceDisabledReason(data.surface, capability);
  if (surfaceReason) return disabledAction(surfaceReason);
  return enabledAction();
}
