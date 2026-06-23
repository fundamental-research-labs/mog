import type { VersionDiagnostic, VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import { displayBranchName } from './version-history-format';

type CurrentStaleStatusCode =
  | 'version.surfaceStatus.currentStale.refMoved'
  | 'version.surfaceStatus.currentStale.activeSessionBehind'
  | 'version.surfaceStatus.currentStale.unverifiedHead';

type CurrentReconciliationStatusCode =
  | 'version.surfaceStatus.pendingRemotePromotion'
  | 'version.surfaceStatus.pendingProviderWrites';

type CurrentStaleStatus = {
  readonly statusCode: CurrentStaleStatusCode;
  readonly reconciliationCode?: CurrentReconciliationStatusCode;
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
        {staleStatus.reconciliationCode ? (
          <span>Remote reconciliation is pending.</span>
        ) : null}
        <span>Destructive version actions remain disabled until this status is refreshed.</span>
      </div>
    </div>
  );
}

function currentStaleStatus(surface: VersionSurfaceStatus): CurrentStaleStatus | undefined {
  const current = surface.current;
  if (!current.stale) return undefined;

  const branchLabel = current.branchName
    ? publicBranchLabel(current.branchName)
    : 'Current checkout';
  const statusCode = currentStaleStatusCode(current.staleReason);

  return {
    statusCode,
    ...currentReconciliationStatusCode(surface),
    message: `${branchLabel} is stale because ${currentStaleReason(statusCode)}.`,
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
): Pick<CurrentStaleStatus, 'reconciliationCode'> {
  if (!surface.dirty.pendingProviderWrites) return {};
  return {
    reconciliationCode: hasPendingRemotePromotion(surface)
      ? 'version.surfaceStatus.pendingRemotePromotion'
      : 'version.surfaceStatus.pendingProviderWrites',
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

function positiveDiagnosticCount(diagnostic: VersionDiagnostic, key: string): boolean {
  const value = diagnostic.data?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function publicBranchLabel(branchName: string): string {
  const label = displayBranchName(branchName);
  return label.length > 0 && !label.startsWith('refs/') ? label : 'Current checkout';
}
