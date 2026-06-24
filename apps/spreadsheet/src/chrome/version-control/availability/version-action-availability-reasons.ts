import type {
  VersionCapability,
  VersionDiagnostic,
  VersionSurfaceStatus,
} from '@mog-sdk/contracts/api';

import { displayBranchName } from '../version-branch-name';
import {
  hostCapabilityDiagnosticDisabledReason,
  publicStatusDiagnosticDisabledReason,
} from './version-action-availability-diagnostics';
import {
  ACTION_CAPABILITY_LABELS,
  DIRTY_STATUS_UNAVAILABLE_REASON,
  VERSIONING_DISABLED_REASON,
  fallbackDiagnosticMessage,
  providerWriteActionForCapability,
  publicStatusActionForCapability,
  unsupportedDirtyDomainActionForCapability,
  type CurrentStaleAction,
  type DirtyDomainAction,
} from './version-action-availability-metadata';
import { sanitizeVersionStatusText } from './version-action-availability-sanitize';
import type {
  DisabledActionReason,
  VersionActionAvailability,
  VersionActionDisabledReasonId,
} from './version-action-availability-types';

export function isCapabilityEnabled(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): boolean {
  return surface.capabilities[capability]?.enabled === true;
}

export function commonActionDisabledReason(
  actionBusy: boolean,
  loading: boolean,
): DisabledActionReason | undefined {
  if (actionBusy) {
    return {
      id: 'version-action-busy',
      message: 'Wait for the current version action to finish.',
    };
  }
  if (loading) {
    return { id: 'version-status-refreshing', message: 'Version status is refreshing.' };
  }
  return undefined;
}

export function actionSurfaceDisabledReason(
  surface: VersionSurfaceStatus | undefined,
  capability: VersionCapability,
): DisabledActionReason | undefined {
  if (!surface) {
    return {
      id: 'version-surface-unavailable',
      message: 'Version surface status is unavailable.',
    };
  }
  if (!surface.featureGateEnabled) {
    return { id: 'versioning-disabled', message: VERSIONING_DISABLED_REASON };
  }
  const readReason = capabilityDisabledReason(surface, 'version:read');
  if (readReason) return readReason;
  const capabilityReason = capabilityDisabledReason(surface, capability);
  if (capabilityReason) return capabilityReason;
  return publicStatusDisabledReason(surface, capability);
}

export function commitDirtyDisabledReason(
  surface: VersionSurfaceStatus,
): DisabledActionReason | undefined {
  const dirty = surface.dirty;

  const providerWriteReason = providerWritesDisabledReason(surface, 'committing');
  if (providerWriteReason) return providerWriteReason;

  const dirtyDomainReason = unsupportedDirtyDomainsDisabledReason(surface, 'commit');
  if (dirtyDomainReason) return dirtyDomainReason;

  if (dirty.pendingRecalc) {
    return {
      id: 'version-recalc-pending',
      message: 'Wait for recalculation to settle before committing.',
    };
  }
  if (dirty.commitEligibleChanges) return undefined;
  if (!dirty.hasUncommittedLocalChanges) {
    return {
      id: 'version-commit-no-local-changes',
      message: 'Make a workbook change before committing.',
    };
  }
  return (
    diagnosticMessageReason(dirty.diagnostics, 'version-commit-no-eligible-changes') ?? {
      id: 'version-commit-no-eligible-changes',
      message: 'No commit-eligible local changes are available.',
    }
  );
}

export function currentStaleDisabledReason(
  surface: VersionSurfaceStatus,
  action: CurrentStaleAction,
): DisabledActionReason | undefined {
  const current = surface.current;
  const staleReason = effectiveCurrentStaleReason(current);
  if (!staleReason) return undefined;

  const branchLabel = current.branchName
    ? displayBranchName(current.branchName)
    : 'Current checkout';
  const reason =
    staleReason === 'refMoved'
      ? 'the branch head moved'
      : staleReason === 'activeSessionBehind'
        ? 'the active checkout session is behind the branch head'
        : 'the current head could not be verified';
  const suffix =
    action === 'commit'
      ? 'Refresh before committing.'
      : action === 'checkout'
        ? 'Checkout is blocked until the active checkout session is refreshed.'
        : action === 'rollback'
          ? 'Refresh before staging rollback.'
          : action === 'review'
            ? 'Refresh before reviewing version changes.'
            : action === 'merge'
              ? 'Refresh before merging.'
              : action === 'remotePromote'
                ? 'Refresh before promoting remote changes.'
                : 'Refresh before exporting version metadata.';
  return {
    id: 'version-head-stale',
    message: `${branchLabel} is stale because ${reason}. ${suffix}`,
  };
}

function effectiveCurrentStaleReason(
  current: VersionSurfaceStatus['current'],
): NonNullable<VersionSurfaceStatus['current']['staleReason']> | undefined {
  if (current.stale) return current.staleReason ?? 'unknown';
  if (
    hasCommitId(current.currentRefHeadId) &&
    hasCommitId(current.refHeadAtMaterialization) &&
    current.currentRefHeadId !== current.refHeadAtMaterialization
  ) {
    return 'refMoved';
  }
  if (
    hasCommitId(current.checkedOutCommitId) &&
    hasCommitId(current.refHeadAtMaterialization) &&
    current.checkedOutCommitId !== current.refHeadAtMaterialization
  ) {
    return 'activeSessionBehind';
  }
  return undefined;
}

function hasCommitId(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function checkoutUnsafeDisabledReason(
  surface: VersionSurfaceStatus,
): DisabledActionReason | undefined {
  const dirty = surface.dirty;
  if (dirty.checkoutSafe) return undefined;

  const dirtyDomainReason = unsupportedDirtyDomainsDisabledReason(surface, 'checkout');
  if (dirtyDomainReason) return dirtyDomainReason;

  if (dirty.pendingRecalc) {
    return {
      id: 'version-recalc-pending',
      message: 'Wait for recalculation to settle before checking out.',
    };
  }

  const diagnosticMessage =
    firstDiagnosticMessage(dirty.unsafeReasons) ?? firstDiagnosticMessage(dirty.diagnostics);
  if (diagnosticMessage) return { id: 'version-checkout-unsafe', message: diagnosticMessage };
  if (dirty.hasUncommittedLocalChanges) {
    return {
      id: 'version-checkout-unsafe',
      message: 'Commit or discard local changes before checking out.',
    };
  }
  return {
    id: 'version-checkout-unsafe',
    message: 'Checkout preflight is unsafe for this workbook.',
  };
}

export function providerWritesDisabledReason(
  surface: VersionSurfaceStatus,
  action: string,
): DisabledActionReason | undefined {
  return surface.dirty.pendingProviderWrites
    ? {
        id: 'version-provider-writes-pending',
        message: `Wait for provider writes to settle before ${action}.`,
      }
    : undefined;
}

export function providerWritesDiagnosticReason(
  surface: VersionSurfaceStatus,
): DisabledActionReason | undefined {
  if (!surface.dirty.pendingProviderWrites) return undefined;
  const pendingProviderDiagnostics = [
    ...surface.dirty.unsafeReasons,
    ...surface.dirty.diagnostics,
  ].filter((diagnostic) => diagnostic.code === 'version.surfaceStatus.pendingProviderWrites');
  return diagnosticMessageReason(pendingProviderDiagnostics, 'version-provider-writes-pending');
}

export function dirtyStatusUnavailableDisabledReason(
  surface: VersionSurfaceStatus,
): DisabledActionReason | undefined {
  const dirty = surface.dirty as Partial<VersionSurfaceStatus['dirty']> & {
    readonly source?: unknown;
  };
  if (
    dirty.source === 'VC-05' &&
    typeof dirty.statusRevision === 'string' &&
    dirty.statusRevision.length > 0 &&
    typeof dirty.checkoutPreflightToken === 'string' &&
    dirty.checkoutPreflightToken.length > 0 &&
    Array.isArray(dirty.unsupportedDirtyDomains) &&
    Array.isArray(dirty.unsafeReasons) &&
    Array.isArray(dirty.diagnostics)
  ) {
    return undefined;
  }

  return {
    id: 'version-dirty-status-unavailable',
    message: DIRTY_STATUS_UNAVAILABLE_REASON,
  };
}

export function enabledAction(): VersionActionAvailability {
  return { enabled: true };
}

export function disabledAction(
  idOrReason: VersionActionDisabledReasonId | DisabledActionReason,
  message?: string,
): VersionActionAvailability {
  const reason =
    typeof idOrReason === 'string'
      ? { id: idOrReason, message: message ?? idOrReason }
      : idOrReason;
  const fallback = fallbackDiagnosticMessage(reason.id);
  return {
    enabled: false,
    disabledReason: sanitizeVersionStatusText(reason.message, fallback) ?? fallback,
    disabledReasonId: reason.id,
  };
}

function publicStatusDisabledReason(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): DisabledActionReason | undefined {
  const hostDeniedReason = hostCapabilityDiagnosticDisabledReason(surface, capability);
  if (hostDeniedReason) return hostDeniedReason;

  const action = publicStatusActionForCapability(capability);
  if (!action) return undefined;

  const staleReason = currentStaleDisabledReason(surface, action);
  if (staleReason) return staleReason;

  const dirtyStatusReason = dirtyStatusDisabledReasonForCapability(surface, capability);
  if (dirtyStatusReason) return dirtyStatusReason;

  const providerWriteReason = providerWritesDisabledReasonForCapability(surface, capability);
  if (providerWriteReason) return providerWriteReason;

  const unsupportedDomainAction = unsupportedDirtyDomainActionForCapability(capability);
  if (unsupportedDomainAction) {
    const unsupportedDomainReason = unsupportedDirtyDomainsDisabledReason(
      surface,
      unsupportedDomainAction,
    );
    if (unsupportedDomainReason) return unsupportedDomainReason;
  }

  return publicStatusDiagnosticDisabledReason(surface, capability);
}

function capabilityDisabledReason(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): DisabledActionReason | undefined {
  const state = surface.capabilities[capability];
  const fallbackReason = `${ACTION_CAPABILITY_LABELS[capability] ?? capability} is unavailable.`;
  if (!state) return { id: 'version-capability-unavailable', message: fallbackReason };
  if (state.enabled) return undefined;
  return {
    id:
      state.dependency === 'hostCapability'
        ? 'version-capability-host-denied'
        : 'version-capability-unavailable',
    message: state.reason || fallbackReason,
  };
}

function dirtyStatusDisabledReasonForCapability(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): DisabledActionReason | undefined {
  return dirtyStatusRequiredForCapability(capability)
    ? dirtyStatusUnavailableDisabledReason(surface)
    : undefined;
}

function dirtyStatusRequiredForCapability(capability: VersionCapability): boolean {
  switch (capability) {
    case 'version:commit':
    case 'version:checkout':
    case 'version:reviewWrite':
    case 'version:proposal':
    case 'version:mergeApply':
    case 'version:revert':
    case 'version:provenance':
    case 'version:remotePromote':
      return true;
    default:
      return false;
  }
}

function providerWritesDisabledReasonForCapability(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): DisabledActionReason | undefined {
  const action = providerWriteActionForCapability(capability);
  if (!action) return undefined;
  if (capability === 'version:commit') {
    return providerWritesDisabledReason(surface, action);
  }
  return providerWritesDiagnosticReason(surface) ?? providerWritesDisabledReason(surface, action);
}

function unsupportedDirtyDomainsDisabledReason(
  surface: VersionSurfaceStatus,
  action: DirtyDomainAction,
): DisabledActionReason | undefined {
  const dirty = surface.dirty;
  if (dirty.unsupportedDirtyDomains.length === 0) return undefined;

  const diagnosticMessage = firstDiagnosticMessage(dirty.diagnostics);
  if (diagnosticMessage && dirty.unsupportedDirtyDomains.includes('unknown')) {
    return { id: 'version-unsupported-domain', message: diagnosticMessage };
  }

  const domains = formatInlineList(dirty.unsupportedDirtyDomains);
  if (action === 'commit') {
    return {
      id: 'version-unsupported-domain',
      message: `Changes in ${domains} cannot be committed yet.`,
    };
  }
  if (action === 'checkout') {
    return {
      id: 'version-unsupported-domain',
      message: `Commit or discard changes in ${domains} before checking out.`,
    };
  }
  const actionLabel =
    action === 'review'
      ? 'reviewed'
      : action === 'merge'
        ? 'merged'
        : 'exported with version metadata';
  return {
    id: 'version-unsupported-domain',
    message: `Changes in ${domains} cannot be ${actionLabel} yet.`,
  };
}

function firstDiagnosticMessage(
  diagnostics: readonly Pick<VersionDiagnostic, 'message'>[],
): string | undefined {
  return diagnostics.find((diagnostic) => diagnostic.message.trim().length > 0)?.message;
}

function diagnosticMessageReason(
  diagnostics: readonly Pick<VersionDiagnostic, 'message'>[],
  id: VersionActionDisabledReasonId,
): DisabledActionReason | undefined {
  const message = firstDiagnosticMessage(diagnostics);
  return message ? { id, message } : undefined;
}

function formatInlineList(values: readonly string[]): string {
  if (values.length <= 3) return values.join(', ');
  return `${values.slice(0, 3).join(', ')} and ${values.length - 3} more`;
}
