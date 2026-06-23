import { GitBranch, GitCommit, Undo2 } from 'lucide-react';
import type { VersionDiagnostic, WorkbookCommitId } from '@mog-sdk/contracts/api';

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
  commitDisabledReason,
  branchDisabledReason,
  rollbackDisabledReason,
  onCommitMessageChange,
  onBranchNameChange,
  onRollbackReasonChange,
  onCommit,
  onCreateBranch,
  onStageRollback,
}: {
  readonly commitMessage: string;
  readonly branchName: string;
  readonly rollbackReason: string;
  readonly targetCommitId?: WorkbookCommitId;
  readonly actionState: VersionActionState;
  readonly commitEnabled: boolean;
  readonly branchEnabled: boolean;
  readonly rollbackEnabled: boolean;
  readonly commitDisabledReason?: string;
  readonly branchDisabledReason?: string;
  readonly rollbackDisabledReason?: string;
  readonly onCommitMessageChange: (value: string) => void;
  readonly onBranchNameChange: (value: string) => void;
  readonly onRollbackReasonChange: (value: string) => void;
  readonly onCommit: () => void;
  readonly onCreateBranch: () => void;
  readonly onStageRollback: () => void;
}): React.JSX.Element {
  const commitReasonId = 'version-commit-disabled-reason';
  const branchReasonId = 'version-branch-disabled-reason';
  const rollbackReasonId = 'version-rollback-disabled-reason';

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

      {actionState.status !== 'idle' ? (
        <div data-testid="version-history-action-result" data-status={actionState.status}>
          <ActionStatus actionState={actionState} />
        </div>
      ) : null}
    </section>
  );
}
