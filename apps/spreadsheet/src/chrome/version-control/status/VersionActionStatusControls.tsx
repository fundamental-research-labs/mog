import { CloudUpload, GitBranch, GitCommit, Undo2 } from 'lucide-react';
import type { WorkbookCommitId } from '@mog-sdk/contracts/api';

import {
  DisabledReason,
  sanitizeVersionStatusText,
} from '../availability/version-action-availability';
import {
  remotePromotionStatusFallbackDetail,
  sanitizeVersionPanelDiagnostic,
  VERSION_ACTION_UNAVAILABLE,
} from './version-action-status-model';
import type {
  VersionActionState,
  VersionRemotePromotionStatus,
} from './version-action-status-types';
import { shortCommitId } from '../version-history-format';

export function ActionStatus({
  actionState,
}: {
  readonly actionState: VersionActionState;
}): React.JSX.Element | null {
  if (actionState.status === 'idle') return null;
  if (actionState.status === 'error') {
    const diagnostic = sanitizeVersionPanelDiagnostic(actionState.diagnostic);
    return (
      <div
        role="alert"
        className="rounded-sm border border-ss-danger/40 bg-ss-danger/10 px-3 py-2 text-body-sm text-ss-text"
      >
        {diagnostic.message}
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

type VersionActionsProps = {
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
};

type DisabledControlStatus = {
  readonly enabled: boolean;
  readonly reasonId: string;
  readonly reason: string | undefined;
};

type VersionActionControls = {
  readonly commit: DisabledControlStatus;
  readonly branch: DisabledControlStatus;
  readonly rollback: DisabledControlStatus;
  readonly remotePromote: DisabledControlStatus;
  readonly remotePromotionDetail: string | undefined;
};

export function VersionActions(props: VersionActionsProps): React.JSX.Element {
  const controls = getVersionActionControls(props);

  return (
    <section className="flex flex-col gap-3" aria-label="Version actions">
      <CommitAction
        message={props.commitMessage}
        control={controls.commit}
        onMessageChange={props.onCommitMessageChange}
        onCommit={props.onCommit}
      />

      <BranchAction
        branchName={props.branchName}
        targetCommitId={props.targetCommitId}
        control={controls.branch}
        onBranchNameChange={props.onBranchNameChange}
        onCreateBranch={props.onCreateBranch}
      />

      <RollbackAction
        reason={props.rollbackReason}
        targetCommitId={props.targetCommitId}
        control={controls.rollback}
        onReasonChange={props.onRollbackReasonChange}
        onStageRollback={props.onStageRollback}
      />

      <RemotePromotionAction
        status={props.remotePromotionStatus}
        detail={controls.remotePromotionDetail}
        control={controls.remotePromote}
        onPromotePendingRemote={props.onPromotePendingRemote}
      />

      {props.actionState.status !== 'idle' ? (
        <div data-testid="version-history-action-result" data-status={props.actionState.status}>
          <ActionStatus actionState={props.actionState} />
        </div>
      ) : null}
    </section>
  );
}

function getVersionActionControls({
  commitEnabled,
  branchEnabled,
  rollbackEnabled,
  remotePromoteEnabled,
  commitDisabledReason,
  branchDisabledReason,
  rollbackDisabledReason,
  remotePromoteDisabledReason,
  remotePromotionStatus,
}: VersionActionsProps): VersionActionControls {
  const commitReason = sanitizeVersionStatusText(commitDisabledReason, VERSION_ACTION_UNAVAILABLE);
  const branchReason = sanitizeVersionStatusText(branchDisabledReason, VERSION_ACTION_UNAVAILABLE);
  const rollbackReason = sanitizeVersionStatusText(
    rollbackDisabledReason,
    VERSION_ACTION_UNAVAILABLE,
  );
  const remotePromoteReason = sanitizeVersionStatusText(
    remotePromoteDisabledReason,
    VERSION_ACTION_UNAVAILABLE,
  );

  return {
    commit: {
      enabled: commitEnabled,
      reasonId: 'version-commit-disabled-reason',
      reason: commitReason,
    },
    branch: {
      enabled: branchEnabled,
      reasonId: 'version-branch-disabled-reason',
      reason: branchReason,
    },
    rollback: {
      enabled: rollbackEnabled,
      reasonId: 'version-rollback-disabled-reason',
      reason: rollbackReason,
    },
    remotePromote: {
      enabled: remotePromoteEnabled,
      reasonId: 'version-remote-promote-disabled-reason',
      reason: remotePromoteReason,
    },
    remotePromotionDetail: sanitizeVersionStatusText(
      remotePromotionStatus.detail,
      remotePromotionStatusFallbackDetail(remotePromotionStatus.state),
    ),
  };
}

function CommitAction({
  message,
  control,
  onMessageChange,
  onCommit,
}: {
  readonly message: string;
  readonly control: DisabledControlStatus;
  readonly onMessageChange: (value: string) => void;
  readonly onCommit: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="version-commit-message" className="text-body-sm font-medium text-ss-text">
        Commit message
      </label>
      <textarea
        id="version-commit-message"
        data-testid="version-history-commit-message-input"
        value={message}
        onChange={(event) => onMessageChange(event.currentTarget.value)}
        rows={2}
        className="w-full resize-none rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-body-sm text-ss-text outline-none focus:border-ss-primary"
      />
      <button
        type="button"
        data-testid="version-history-commit-button"
        onClick={onCommit}
        disabled={!control.enabled}
        aria-describedby={!control.enabled && control.reason ? control.reasonId : undefined}
        title={!control.enabled ? control.reason : undefined}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
      >
        <GitCommit size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>Commit</span>
      </button>
      <DisabledReason
        id={control.reasonId}
        reason={!control.enabled ? control.reason : undefined}
      />
    </div>
  );
}

function BranchAction({
  branchName,
  targetCommitId,
  control,
  onBranchNameChange,
  onCreateBranch,
}: {
  readonly branchName: string;
  readonly targetCommitId: WorkbookCommitId | undefined;
  readonly control: DisabledControlStatus;
  readonly onBranchNameChange: (value: string) => void;
  readonly onCreateBranch: () => void;
}): React.JSX.Element {
  return (
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
        <TargetSummary testId="version-history-branch-target-summary" commitId={targetCommitId} />
        <button
          type="button"
          data-testid="version-history-create-branch-button"
          onClick={onCreateBranch}
          disabled={!control.enabled}
          aria-describedby={!control.enabled && control.reason ? control.reasonId : undefined}
          title={!control.enabled ? control.reason : undefined}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
        >
          <GitBranch size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>Create branch</span>
        </button>
      </div>
      <DisabledReason
        id={control.reasonId}
        reason={!control.enabled ? control.reason : undefined}
      />
    </div>
  );
}

function RollbackAction({
  reason,
  targetCommitId,
  control,
  onReasonChange,
  onStageRollback,
}: {
  readonly reason: string;
  readonly targetCommitId: WorkbookCommitId | undefined;
  readonly control: DisabledControlStatus;
  readonly onReasonChange: (value: string) => void;
  readonly onStageRollback: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="version-rollback-reason" className="text-body-sm font-medium text-ss-text">
        Rollback reason
      </label>
      <textarea
        id="version-rollback-reason"
        data-testid="version-history-rollback-reason-input"
        value={reason}
        onChange={(event) => onReasonChange(event.currentTarget.value)}
        rows={2}
        className="w-full resize-none rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-body-sm text-ss-text outline-none focus:border-ss-primary"
      />
      <div className="flex items-center justify-between gap-2">
        <TargetSummary testId="version-history-rollback-target-summary" commitId={targetCommitId} />
        <button
          type="button"
          data-testid="version-history-stage-rollback-button"
          onClick={onStageRollback}
          disabled={!control.enabled}
          aria-describedby={!control.enabled && control.reason ? control.reasonId : undefined}
          title={!control.enabled ? control.reason : undefined}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
        >
          <Undo2 size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>Stage rollback</span>
        </button>
      </div>
      <DisabledReason
        id={control.reasonId}
        reason={!control.enabled ? control.reason : undefined}
      />
    </div>
  );
}

function RemotePromotionAction({
  status,
  detail,
  control,
  onPromotePendingRemote,
}: {
  readonly status: VersionRemotePromotionStatus;
  readonly detail: string | undefined;
  readonly control: DisabledControlStatus;
  readonly onPromotePendingRemote: () => void;
}): React.JSX.Element {
  return (
    <div
      className="rounded-sm border border-ss-border bg-ss-surface px-2.5 py-2"
      data-testid="version-history-remote-promote-status"
      data-state={status.state}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-sm font-medium text-ss-text">Remote backlog</span>
        <span className="text-[11px] uppercase text-ss-text-tertiary">{status.label}</span>
      </div>
      {detail ? (
        <div className="mt-1 text-[11px] leading-snug text-ss-text-secondary">{detail}</div>
      ) : null}
      <button
        type="button"
        data-testid="version-history-promote-remote-button"
        onClick={onPromotePendingRemote}
        disabled={!control.enabled}
        aria-describedby={!control.enabled && control.reason ? control.reasonId : undefined}
        title={!control.enabled ? control.reason : undefined}
        className="mt-2 inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
      >
        <CloudUpload size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>Promote remote</span>
      </button>
      <DisabledReason
        id={control.reasonId}
        reason={!control.enabled ? control.reason : undefined}
      />
    </div>
  );
}

function TargetSummary({
  testId,
  commitId,
}: {
  readonly testId: string;
  readonly commitId: WorkbookCommitId | undefined;
}): React.JSX.Element {
  return (
    <span
      className="min-w-0 font-mono text-[11px] text-ss-text-secondary truncate"
      data-testid={testId}
      data-version-commit-id={commitId}
    >
      Target {commitId ? shortCommitId(commitId) : 'unavailable'}
    </span>
  );
}
