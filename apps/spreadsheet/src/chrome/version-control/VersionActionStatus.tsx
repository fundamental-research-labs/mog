import { CloudUpload, GitBranch, GitCommit, Undo2 } from 'lucide-react';
import type {
  JsonValue,
  VersionDiagnostic,
  VersionPromotePendingRemoteResult,
  VersionSurfaceStatus,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { DisabledReason } from './version-action-availability';
import { shortCommitId } from './version-history-format';

export type VersionPanelDiagnostic = {
  readonly code: string;
  readonly severity: VersionDiagnostic['severity'];
  readonly message: string;
};

export type VersionActionState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly label: string }
  | { readonly status: 'success'; readonly message: string }
  | { readonly status: 'error'; readonly diagnostic: VersionPanelDiagnostic };

export type VersionRemotePromotionStatus = {
  readonly state: 'ready' | 'pending' | 'running' | 'unavailable';
  readonly label: string;
  readonly detail?: string;
};

export function ActionStatus({
  actionState,
}: {
  readonly actionState: VersionActionState;
}): React.JSX.Element | null {
  if (actionState.status === 'idle') return null;
  if (actionState.status === 'error') {
    return (
      <div
        role="alert"
        className="rounded-sm border border-ss-danger/40 bg-ss-danger/10 px-3 py-2 text-body-sm text-ss-text"
      >
        {actionState.diagnostic.message}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={actionState.status === 'running'}
      className="rounded-sm border border-ss-border bg-ss-surface-secondary px-3 py-2 text-body-sm text-ss-text-secondary"
    >
      {actionState.status === 'running' ? actionState.label : actionState.message}
    </div>
  );
}

export function VersionActions({
  commitMessage,
  branchName,
  rollbackReason,
  targetCommitId,
  actionState,
  commitEnabled,
  branchEnabled,
  rollbackEnabled,
  remotePromoteEnabled,
  commitDisabledReason,
  branchDisabledReason,
  rollbackDisabledReason,
  remotePromoteDisabledReason,
  remotePromotionStatus,
  onCommitMessageChange,
  onBranchNameChange,
  onRollbackReasonChange,
  onCommit,
  onCreateBranch,
  onStageRollback,
  onPromotePendingRemote,
}: {
  readonly commitMessage: string;
  readonly branchName: string;
  readonly rollbackReason: string;
  readonly targetCommitId?: WorkbookCommitId;
  readonly actionState: VersionActionState;
  readonly commitEnabled: boolean;
  readonly branchEnabled: boolean;
  readonly rollbackEnabled: boolean;
  readonly remotePromoteEnabled: boolean;
  readonly commitDisabledReason?: string;
  readonly branchDisabledReason?: string;
  readonly rollbackDisabledReason?: string;
  readonly remotePromoteDisabledReason?: string;
  readonly remotePromotionStatus: VersionRemotePromotionStatus;
  readonly onCommitMessageChange: (value: string) => void;
  readonly onBranchNameChange: (value: string) => void;
  readonly onRollbackReasonChange: (value: string) => void;
  readonly onCommit: () => void;
  readonly onCreateBranch: () => void;
  readonly onStageRollback: () => void;
  readonly onPromotePendingRemote: () => void;
}): React.JSX.Element {
  const commitReasonId = 'version-commit-disabled-reason';
  const branchReasonId = 'version-branch-disabled-reason';
  const rollbackReasonId = 'version-rollback-disabled-reason';
  const remotePromoteReasonId = 'version-remote-promote-disabled-reason';

  return (
    <section className="flex flex-col gap-3" aria-label="Version actions">
      <div className="flex flex-col gap-2">
        <label htmlFor="version-commit-message" className="text-body-sm font-medium text-ss-text">
          Commit message
        </label>
        <textarea
          id="version-commit-message"
          data-testid="version-history-commit-message-input"
          value={commitMessage}
          onChange={(event) => onCommitMessageChange(event.currentTarget.value)}
          rows={2}
          className="w-full resize-none rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-body-sm text-ss-text outline-none focus:border-ss-primary"
        />
        <button
          type="button"
          data-testid="version-history-commit-button"
          onClick={onCommit}
          disabled={!commitEnabled}
          aria-describedby={!commitEnabled && commitDisabledReason ? commitReasonId : undefined}
          title={!commitEnabled ? commitDisabledReason : undefined}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
        >
          <GitCommit size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>Commit</span>
        </button>
        <DisabledReason
          id={commitReasonId}
          reason={!commitEnabled ? commitDisabledReason : undefined}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="version-branch-name" className="text-body-sm font-medium text-ss-text">
          Branch name
        </label>
        <input
          id="version-branch-name"
          data-testid="version-history-branch-name-input"
          type="text"
          value={branchName}
          onChange={(event) => onBranchNameChange(event.currentTarget.value)}
          className="w-full rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-body-sm text-ss-text outline-none focus:border-ss-primary"
        />
        <div className="flex items-center justify-between gap-2">
          <span
            className="min-w-0 font-mono text-[11px] text-ss-text-secondary truncate"
            data-testid="version-history-branch-target-summary"
            data-version-commit-id={targetCommitId}
          >
            Target {targetCommitId ? shortCommitId(targetCommitId) : 'unavailable'}
          </span>
          <button
            type="button"
            data-testid="version-history-create-branch-button"
            onClick={onCreateBranch}
            disabled={!branchEnabled}
            aria-describedby={!branchEnabled && branchDisabledReason ? branchReasonId : undefined}
            title={!branchEnabled ? branchDisabledReason : undefined}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
          >
            <GitBranch size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>Create branch</span>
          </button>
        </div>
        <DisabledReason
          id={branchReasonId}
          reason={!branchEnabled ? branchDisabledReason : undefined}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="version-rollback-reason" className="text-body-sm font-medium text-ss-text">
          Rollback reason
        </label>
        <textarea
          id="version-rollback-reason"
          data-testid="version-history-rollback-reason-input"
          value={rollbackReason}
          onChange={(event) => onRollbackReasonChange(event.currentTarget.value)}
          rows={2}
          className="w-full resize-none rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-body-sm text-ss-text outline-none focus:border-ss-primary"
        />
        <div className="flex items-center justify-between gap-2">
          <span
            className="min-w-0 font-mono text-[11px] text-ss-text-secondary truncate"
            data-testid="version-history-rollback-target-summary"
            data-version-commit-id={targetCommitId}
          >
            Target {targetCommitId ? shortCommitId(targetCommitId) : 'unavailable'}
          </span>
          <button
            type="button"
            data-testid="version-history-stage-rollback-button"
            onClick={onStageRollback}
            disabled={!rollbackEnabled}
            aria-describedby={
              !rollbackEnabled && rollbackDisabledReason ? rollbackReasonId : undefined
            }
            title={!rollbackEnabled ? rollbackDisabledReason : undefined}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
          >
            <Undo2 size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>Stage rollback</span>
          </button>
        </div>
        <DisabledReason
          id={rollbackReasonId}
          reason={!rollbackEnabled ? rollbackDisabledReason : undefined}
        />
      </div>

      <div
        className="rounded-sm border border-ss-border bg-ss-surface px-2.5 py-2"
        data-testid="version-history-remote-promote-status"
        data-state={remotePromotionStatus.state}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-body-sm font-medium text-ss-text">Remote backlog</span>
          <span className="text-[11px] uppercase text-ss-text-tertiary">
            {remotePromotionStatus.label}
          </span>
        </div>
        {remotePromotionStatus.detail ? (
          <div className="mt-1 text-[11px] leading-snug text-ss-text-secondary">
            {remotePromotionStatus.detail}
          </div>
        ) : null}
        <button
          type="button"
          data-testid="version-history-promote-remote-button"
          onClick={onPromotePendingRemote}
          disabled={!remotePromoteEnabled}
          aria-describedby={
            !remotePromoteEnabled && remotePromoteDisabledReason
              ? remotePromoteReasonId
              : undefined
          }
          title={!remotePromoteEnabled ? remotePromoteDisabledReason : undefined}
          className="mt-2 inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
        >
          <CloudUpload size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>Promote remote</span>
        </button>
        <DisabledReason
          id={remotePromoteReasonId}
          reason={!remotePromoteEnabled ? remotePromoteDisabledReason : undefined}
        />
      </div>

      {actionState.status !== 'idle' ? (
        <div data-testid="version-history-action-result" data-status={actionState.status}>
          <ActionStatus actionState={actionState} />
        </div>
      ) : null}
    </section>
  );
}

export function getRemotePromotionStatus(
  surface: VersionSurfaceStatus | undefined,
): VersionRemotePromotionStatus {
  if (!surface) {
    return {
      state: 'unavailable',
      label: 'Unavailable',
      detail: 'Version surface status is unavailable.',
    };
  }

  const remotePromoteState = surface.capabilities['version:remotePromote'];
  if (remotePromoteState?.enabled === false) {
    return {
      state: 'unavailable',
      label: 'Unavailable',
      detail: remotePromoteState.reason,
    };
  }

  const providerWriteDiagnostic = firstPendingProviderWritesDiagnostic(surface);
  const counts = providerWriteDiagnostic ? pendingRemoteCounts(providerWriteDiagnostic.data) : {};
  const detail = providerWriteDiagnostic?.message;

  if ((counts.pendingRemotePromotionActiveCount ?? 0) > 0) {
    return {
      state: 'running',
      label: 'Running',
      detail: detail ?? 'Pending remote promotion is already running.',
    };
  }

  if (
    (counts.pendingRemoteSegmentCount ?? 0) > 0 ||
    (counts.pendingRemotePromotionQueuedCount ?? 0) > 0
  ) {
    const pendingSegmentCount = counts.pendingRemoteSegmentCount ?? 0;
    const queuedCount = counts.pendingRemotePromotionQueuedCount ?? 0;
    return {
      state: 'pending',
      label: 'Pending',
      detail:
        detail ??
        formatPendingRemoteDetail({
          pendingRemoteSegmentCount: pendingSegmentCount,
          pendingRemotePromotionQueuedCount: queuedCount,
        }),
    };
  }

  if (surface.dirty.pendingProviderWrites) {
    return {
      state: 'pending',
      label: 'Pending',
      detail: detail ?? 'Provider writes are pending.',
    };
  }

  return {
    state: 'ready',
    label: 'Ready',
  };
}

export function remotePromotionActionMessage(
  result: VersionPromotePendingRemoteResult,
): string {
  const promoted = result.promotedSegmentIds.length;
  const skipped = result.skipped.length;
  if (result.status === 'partial') {
    return `Promoted ${formatCount(promoted, 'pending remote segment')}; skipped ${skipped}`;
  }
  if (promoted === 0) return 'No pending remote changes to promote';
  return `Promoted ${formatCount(promoted, 'pending remote segment')} into ${formatCount(
    result.commitIds.length,
    'commit',
  )}`;
}

export function diagnosticFromRemotePromotionResult(
  code: string,
  result: VersionPromotePendingRemoteResult,
): VersionPanelDiagnostic {
  const diagnostic = result.diagnostics.find((entry) => entry.message.trim().length > 0);
  if (diagnostic) {
    return {
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
    };
  }
  const skipped = result.skipped.find((entry) => entry.message.trim().length > 0);
  if (skipped) {
    return {
      code,
      severity: 'warning',
      message: skipped.message,
    };
  }
  return {
    code,
    severity: 'warning',
    message: 'Pending remote promotion did not promote any backlog entries.',
  };
}

function firstPendingProviderWritesDiagnostic(
  surface: VersionSurfaceStatus,
): VersionDiagnostic | undefined {
  return [...surface.dirty.unsafeReasons, ...surface.dirty.diagnostics].find(
    (diagnostic) => diagnostic.code === 'version.surfaceStatus.pendingProviderWrites',
  );
}

function pendingRemoteCounts(
  data: Readonly<Record<string, JsonValue>> | undefined,
): {
  readonly pendingRemoteSegmentCount?: number;
  readonly pendingRemotePromotionActiveCount?: number;
  readonly pendingRemotePromotionQueuedCount?: number;
} {
  if (!data) return {};
  return {
    pendingRemoteSegmentCount: numberValue(data['pendingRemoteSegmentCount']),
    pendingRemotePromotionActiveCount: numberValue(data['pendingRemotePromotionActiveCount']),
    pendingRemotePromotionQueuedCount: numberValue(data['pendingRemotePromotionQueuedCount']),
  };
}

function numberValue(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatPendingRemoteDetail({
  pendingRemoteSegmentCount,
  pendingRemotePromotionQueuedCount,
}: {
  readonly pendingRemoteSegmentCount: number;
  readonly pendingRemotePromotionQueuedCount: number;
}): string {
  const parts: string[] = [];
  if (pendingRemoteSegmentCount > 0) {
    parts.push(
      `${pendingRemoteSegmentCount} pending remote ${pendingRemoteSegmentCount === 1 ? 'segment' : 'segments'}`,
    );
  }
  if (pendingRemotePromotionQueuedCount > 0) {
    parts.push(
      `${pendingRemotePromotionQueuedCount} queued ${pendingRemotePromotionQueuedCount === 1 ? 'promotion' : 'promotions'}`,
    );
  }
  return parts.length > 0 ? parts.join(', ') : 'Pending remote promotion is queued.';
}

function formatCount(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}
