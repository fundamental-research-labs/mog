import type { VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import { displayBranchName, shortCommitId } from './version-history-format';

type CurrentStaleStatus = {
  readonly checkedOutCommitId?: string;
  readonly latestCommitId?: string;
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
      data-checked-out-commit-id={staleStatus.checkedOutCommitId}
      data-latest-commit-id={staleStatus.latestCommitId}
      className="rounded-sm border border-ss-warning/40 bg-ss-warning/10 px-3 py-2 text-body-sm"
    >
      <div className="font-medium text-ss-text">Current checkout is stale</div>
      <div className="text-ss-text-secondary">{staleStatus.message}</div>
      <div className="mt-1 grid grid-cols-[72px_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <span className="text-ss-text-secondary">Checked out</span>
        <span className="font-mono text-ss-text truncate">
          {staleStatus.checkedOutCommitId
            ? shortCommitId(staleStatus.checkedOutCommitId)
            : 'Unavailable'}
        </span>
        <span className="text-ss-text-secondary">Latest</span>
        <span className="font-mono text-ss-text truncate">
          {staleStatus.latestCommitId ? shortCommitId(staleStatus.latestCommitId) : 'Unknown'}
        </span>
      </div>
    </div>
  );
}

function currentStaleStatus(surface: VersionSurfaceStatus): CurrentStaleStatus | undefined {
  const current = surface.current;
  if (!current.stale) return undefined;

  const branchLabel = current.branchName
    ? displayBranchName(current.branchName)
    : 'Current checkout';
  const reason =
    current.staleReason === 'refMoved'
      ? 'the branch head moved'
      : current.staleReason === 'activeSessionBehind'
        ? 'the active checkout session is behind the branch head'
        : 'the current head could not be verified';
  const checkedOutCommitId = current.checkedOutCommitId ?? current.headCommitId;
  const latestCommitId = current.currentRefHeadId ?? current.refHeadAtMaterialization;

  return {
    ...(checkedOutCommitId ? { checkedOutCommitId } : {}),
    ...(latestCommitId ? { latestCommitId } : {}),
    message: `${branchLabel} is stale because ${reason}.`,
  };
}
