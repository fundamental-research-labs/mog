import type { VersionDiagnostic, VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import { normalizeVersionBranchNameInput } from './version-branch-name';

type CurrentStaleStatusCode =
  | 'version.surfaceStatus.currentStale.refMoved'
  | 'version.surfaceStatus.currentStale.activeSessionBehind'
  | 'version.surfaceStatus.currentStale.unverifiedHead';

type CurrentReconciliationStatusCode =
  | 'version.surfaceStatus.dirtyStatusUnavailable'
  | 'version.surfaceStatus.pendingRemotePromotion'
  | 'version.surfaceStatus.pendingProviderWrites'
  | 'version.surfaceStatus.pendingProviderWritesUnknown';

type CurrentReconciliationStatus = {
  readonly reconciliationCode: CurrentReconciliationStatusCode;
  readonly reconciliationMessage: string;
};

type CurrentStaleStatus = {
  readonly statusCode: CurrentStaleStatusCode;
  readonly reconciliationCode?: CurrentReconciliationStatusCode;
  readonly reconciliationMessage?: string;
  readonly message: string;
};

export function VersionCurrentStaleStatus({
  surface,
}: {
  readonly surface?: VersionSurfaceStatus;
}): React.JSX.Element | null {
  const staleStatus = surface ? currentStaleStatus(surface) : undefined;
  if (!staleStatus) return null;

  return (
    <div
      role="status"
      data-testid="version-history-current-stale-status"
      data-status-code={staleStatus.statusCode}
      data-reconciliation-code={staleStatus.reconciliationCode}
      className="rounded-sm border border-ss-warning/40 bg-ss-warning/10 px-3 py-2 text-body-sm"
    >
      <div className="font-medium text-ss-text">Current checkout is stale</div>
      <div className="text-ss-text-secondary">{staleStatus.message}</div>
      <div className="mt-1 flex flex-col gap-0.5 text-[11px] leading-snug text-ss-text-secondary">
        {staleStatus.reconciliationMessage ? (
          <span>{staleStatus.reconciliationMessage}</span>
        ) : null}
        <span>Destructive version actions remain disabled until this status is refreshed.</span>
      </div>
    </div>
  );
}

function currentStaleStatus(surface: VersionSurfaceStatus): CurrentStaleStatus | undefined {
  const current = surface.current;
  if (!current.stale) return undefined;

  const checkoutLabel = currentCheckoutLabel(current);
  const statusCode = currentStaleStatusCode(current.staleReason);

  return {
    statusCode,
    ...currentReconciliationStatusCode(surface),
    message: `${checkoutLabel} is stale because ${currentStaleReason(statusCode)}.`,
  };
}

function currentStaleStatusCode(
  staleReason: VersionSurfaceStatus['current']['staleReason'],
): CurrentStaleStatusCode {
  if (staleReason === 'refMoved') return 'version.surfaceStatus.currentStale.refMoved';
  if (staleReason === 'activeSessionBehind') {
    return 'version.surfaceStatus.currentStale.activeSessionBehind';
  }
  return 'version.surfaceStatus.currentStale.unverifiedHead';
}

function currentStaleReason(statusCode: CurrentStaleStatusCode): string {
  if (statusCode === 'version.surfaceStatus.currentStale.refMoved') {
    return 'the branch head moved';
  }
  if (statusCode === 'version.surfaceStatus.currentStale.activeSessionBehind') {
    return 'the active checkout session is behind the branch head';
  }
  return 'the current head could not be verified';
}

function currentReconciliationStatusCode(
  surface: VersionSurfaceStatus,
): Pick<CurrentStaleStatus, 'reconciliationCode' | 'reconciliationMessage'> {
  if (!hasTrustedDirtyStatus(surface)) {
    return {
      reconciliationCode: 'version.surfaceStatus.dirtyStatusUnavailable',
      reconciliationMessage:
        'Dirty status is unavailable; refresh version status before continuing.',
    };
  }
  if (!surface.dirty.pendingProviderWrites) return {};
  const reconciliation = currentReconciliationStatus(surface);
  return {
    reconciliationCode: reconciliation.reconciliationCode,
    reconciliationMessage: reconciliation.reconciliationMessage,
  };
}

function hasTrustedDirtyStatus(surface: VersionSurfaceStatus): boolean {
  const dirty = surface.dirty as Partial<VersionSurfaceStatus['dirty']> & {
    readonly source?: unknown;
  };
  return (
    dirty.source === 'VC-05' &&
    typeof dirty.statusRevision === 'string' &&
    dirty.statusRevision.length > 0 &&
    typeof dirty.checkoutPreflightToken === 'string' &&
    dirty.checkoutPreflightToken.length > 0 &&
    Array.isArray(dirty.unsupportedDirtyDomains) &&
    Array.isArray(dirty.unsafeReasons) &&
    Array.isArray(dirty.diagnostics)
  );
}

function currentReconciliationStatus(surface: VersionSurfaceStatus): CurrentReconciliationStatus {
  if (hasPendingRemotePromotion(surface)) {
    return {
      reconciliationCode: 'version.surfaceStatus.pendingRemotePromotion',
      reconciliationMessage: 'Remote reconciliation is pending.',
    };
  }

  if (hasUnknownProviderWriteState(surface)) {
    return {
      reconciliationCode: 'version.surfaceStatus.pendingProviderWritesUnknown',
      reconciliationMessage:
        'Provider write state is unknown; refresh after provider status settles.',
    };
  }

  return {
    reconciliationCode: 'version.surfaceStatus.pendingProviderWrites',
    reconciliationMessage: 'Provider writes are still settling.',
  };
}

function hasPendingRemotePromotion(surface: VersionSurfaceStatus): boolean {
  return [...surface.dirty.unsafeReasons, ...surface.dirty.diagnostics].some((diagnostic) => {
    if (diagnostic.code !== 'version.surfaceStatus.pendingProviderWrites') return false;
    return (
      positiveDiagnosticCount(diagnostic, 'pendingRemoteSegmentCount') ||
      positiveDiagnosticCount(diagnostic, 'pendingRemotePromotionActiveCount') ||
      positiveDiagnosticCount(diagnostic, 'pendingRemotePromotionQueuedCount')
    );
  });
}

function hasUnknownProviderWriteState(surface: VersionSurfaceStatus): boolean {
  const diagnostics = [...surface.dirty.unsafeReasons, ...surface.dirty.diagnostics];
  return (
    !diagnostics.some(
      (diagnostic) => diagnostic.code === 'version.surfaceStatus.pendingProviderWrites',
    ) ||
    diagnostics.some(
      (diagnostic) => diagnostic.code === 'version.surfaceStatus.pendingProviderWritesReadFailed',
    )
  );
}

function positiveDiagnosticCount(diagnostic: VersionDiagnostic, key: string): boolean {
  const value = diagnostic.data?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function currentCheckoutLabel(current: VersionSurfaceStatus['current']): string {
  if (current.detached) return 'Detached checkout';
  if (!current.branchName) return 'Current checkout';

  const branchLabel = publicBranchLabel(current.branchName);
  return branchLabel ? `Checkout from ${branchLabel}` : 'Current checkout';
}

function publicBranchLabel(branchName: string): string | undefined {
  const normalized = normalizeVersionBranchNameInput(branchName);
  return normalized.ok ? normalized.branch.displayName : undefined;
}
