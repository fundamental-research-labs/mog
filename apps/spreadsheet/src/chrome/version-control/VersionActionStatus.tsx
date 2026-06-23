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
  const commitReason = sanitizeVersionStatusText(commitDisabledReason, VERSION_ACTION_UNAVAILABLE);
  const branchReason = sanitizeVersionStatusText(branchDisabledReason, VERSION_ACTION_UNAVAILABLE);
  const rollbackDisabledStatusReason = sanitizeVersionStatusText(
    rollbackDisabledReason,
    VERSION_ACTION_UNAVAILABLE,
  );
  const remotePromoteReason = sanitizeVersionStatusText(
    remotePromoteDisabledReason,
    VERSION_ACTION_UNAVAILABLE,
  );
  const remotePromotionDetail = sanitizeVersionStatusText(
    remotePromotionStatus.detail,
    remotePromotionStatusFallbackDetail(remotePromotionStatus.state),
  );

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
          aria-describedby={!commitEnabled && commitReason ? commitReasonId : undefined}
          title={!commitEnabled ? commitReason : undefined}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
        >
          <GitCommit size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>Commit</span>
        </button>
        <DisabledReason id={commitReasonId} reason={!commitEnabled ? commitReason : undefined} />
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
            aria-describedby={!branchEnabled && branchReason ? branchReasonId : undefined}
            title={!branchEnabled ? branchReason : undefined}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
          >
            <GitBranch size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>Create branch</span>
          </button>
        </div>
        <DisabledReason id={branchReasonId} reason={!branchEnabled ? branchReason : undefined} />
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
              !rollbackEnabled && rollbackDisabledStatusReason ? rollbackReasonId : undefined
            }
            title={!rollbackEnabled ? rollbackDisabledStatusReason : undefined}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
          >
            <Undo2 size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>Stage rollback</span>
          </button>
        </div>
        <DisabledReason
          id={rollbackReasonId}
          reason={!rollbackEnabled ? rollbackDisabledStatusReason : undefined}
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
        {remotePromotionDetail ? (
          <div className="mt-1 text-[11px] leading-snug text-ss-text-secondary">
            {remotePromotionDetail}
          </div>
        ) : null}
        <button
          type="button"
          data-testid="version-history-promote-remote-button"
          onClick={onPromotePendingRemote}
          disabled={!remotePromoteEnabled}
          aria-describedby={
            !remotePromoteEnabled && remotePromoteReason ? remotePromoteReasonId : undefined
          }
          title={!remotePromoteEnabled ? remotePromoteReason : undefined}
          className="mt-2 inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
        >
          <CloudUpload size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>Promote remote</span>
        </button>
        <DisabledReason
          id={remotePromoteReasonId}
          reason={!remotePromoteEnabled ? remotePromoteReason : undefined}
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
      detail: sanitizeVersionStatusText(
        remotePromoteState.reason,
        'Remote promotion is unavailable.',
      ),
    };
  }

  const providerWriteDiagnostic = firstPendingProviderWritesDiagnostic(surface);
  const counts = providerWriteDiagnostic ? pendingRemoteCounts(providerWriteDiagnostic.data) : {};
  const detail = sanitizeVersionStatusText(
    providerWriteDiagnostic?.message,
    'Provider writes are pending.',
  );

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

export function remotePromotionActionMessage(result: VersionPromotePendingRemoteResult): string {
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
  const candidate = firstRemotePromotionDiagnosticCandidate(code, result);
  if (candidate) return sanitizeVersionPanelDiagnostic(candidate.diagnostic);
  return sanitizeVersionPanelDiagnostic({
    code,
    severity: 'warning',
    message: remotePromotionFallbackMessage(result.status),
  });
}

const VERSION_ACTION_UNAVAILABLE = 'Version action is unavailable.';
const REDACTED_VERSION_REF = '[version ref]';
const REDACTED_PRINCIPAL = '[principal]';
const REDACTED_COMMIT = '[commit]';
const REDACTED_PENDING_REMOTE_SEGMENT = '[pending remote segment]';
const REDACTED_SYNC_BATCH = '[sync batch]';

type RemotePromotionDiagnosticCandidate = {
  readonly diagnostic: VersionPanelDiagnostic;
  readonly categoryRank: number;
  readonly severityRank: number;
  readonly codeRank: string;
  readonly index: number;
};

function firstRemotePromotionDiagnosticCandidate(
  code: string,
  result: VersionPromotePendingRemoteResult,
): RemotePromotionDiagnosticCandidate | undefined {
  const candidates: RemotePromotionDiagnosticCandidate[] = [];
  result.diagnostics.forEach((diagnostic, index) => {
    if (diagnostic.message.trim().length === 0) return;
    candidates.push(
      remotePromotionDiagnosticCandidate(
        {
          code: diagnostic.code,
          severity: diagnostic.severity,
          message: diagnostic.message,
        },
        diagnostic.reason,
        index,
      ),
    );
  });
  const skippedOffset = result.diagnostics.length;
  result.skipped.forEach((skipped, index) => {
    if (skipped.message.trim().length === 0) return;
    candidates.push(
      remotePromotionDiagnosticCandidate(
        {
          code,
          severity: 'warning',
          message: skipped.message,
        },
        skipped.reason,
        skippedOffset + index,
      ),
    );
  });
  return candidates.sort(compareRemotePromotionDiagnosticCandidates)[0];
}

function remotePromotionDiagnosticCandidate(
  diagnostic: VersionPanelDiagnostic,
  reason: string | undefined,
  index: number,
): RemotePromotionDiagnosticCandidate {
  return {
    diagnostic,
    categoryRank: diagnosticCategoryRank(diagnostic, reason),
    severityRank: severityRank(diagnostic.severity),
    codeRank: diagnostic.code,
    index,
  };
}

function compareRemotePromotionDiagnosticCandidates(
  left: RemotePromotionDiagnosticCandidate,
  right: RemotePromotionDiagnosticCandidate,
): number {
  return (
    left.categoryRank - right.categoryRank ||
    left.severityRank - right.severityRank ||
    left.codeRank.localeCompare(right.codeRank) ||
    left.index - right.index
  );
}

function diagnosticCategoryRank(
  diagnostic: VersionPanelDiagnostic,
  reason: string | undefined,
): number {
  const normalized = `${diagnostic.code} ${reason ?? ''} ${diagnostic.message}`.toLowerCase();
  if (normalized.includes('blocked') || normalized.includes('terminal')) return 0;
  if (
    normalized.includes('failed') ||
    normalized.includes('failure') ||
    normalized.includes('error')
  ) {
    return 1;
  }
  if (normalized.includes('degraded')) return 2;
  return 3;
}

function severityRank(severity: VersionPanelDiagnostic['severity']): number {
  if (severity === 'error') return 0;
  if (severity === 'warning') return 1;
  return 2;
}

function sanitizeVersionPanelDiagnostic(
  diagnostic: VersionPanelDiagnostic,
): VersionPanelDiagnostic {
  return {
    ...diagnostic,
    message:
      sanitizeVersionStatusText(diagnostic.message, fallbackDiagnosticMessage(diagnostic)) ??
      fallbackDiagnosticMessage(diagnostic),
  };
}

function sanitizeVersionStatusText(
  value: string | undefined,
  fallback: string,
): string | undefined {
  const message = value?.trim() ?? '';
  if (message.length === 0) return undefined;
  const redacted = redactSensitiveVersionDiagnosticText(message).replace(/\s+/g, ' ').trim();
  return redacted.length > 0 ? redacted : fallback;
}

function redactSensitiveVersionDiagnosticText(message: string): string {
  return message
    .replace(
      /["']?\bprincipal(?:Id|Ids|Ref|Scope|Tag|Tags|_tags)?\b["']?\s*:\s*(?:"[^"]*"|'[^']*'|[^\s,;)}]+)/gi,
      `principal ${REDACTED_PRINCIPAL}`,
    )
    .replace(
      /\bprincipal(?:Id|Ids|Ref|Scope|Tag|Tags|_tags)?\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;)}]+)/gi,
      `principal ${REDACTED_PRINCIPAL}`,
    )
    .replace(
      /\bprincipal\b\s+(?:"[^"]*"|'[^']*'|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|principal:[^\s,;)}]+)/gi,
      `principal ${REDACTED_PRINCIPAL}`,
    )
    .replace(/\brefs\/[^\s"'`<>),;]+/g, REDACTED_VERSION_REF)
    .replace(/\bcommit:sha256:[0-9a-f]{12,64}\b/gi, REDACTED_COMMIT)
    .replace(/\bpending-remote-segment:sha256:[0-9a-f]{12,64}\b/gi, REDACTED_PENDING_REMOTE_SEGMENT)
    .replace(/\bsync-batch-status:sha256:[0-9a-f]{12,64}\b/gi, REDACTED_SYNC_BATCH);
}

function fallbackDiagnosticMessage(diagnostic: VersionPanelDiagnostic): string {
  if (diagnosticCategoryRank(diagnostic, undefined) === 0) {
    return 'Version action is blocked.';
  }
  if (diagnostic.severity === 'error') return 'Version action failed.';
  return VERSION_ACTION_UNAVAILABLE;
}

function remotePromotionFallbackMessage(
  status: VersionPromotePendingRemoteResult['status'],
): string {
  if (status === 'failed') return 'Pending remote promotion failed.';
  if (status === 'partial')
    return 'Pending remote promotion completed with skipped backlog entries.';
  return 'Pending remote promotion did not promote any backlog entries.';
}

function remotePromotionStatusFallbackDetail(state: VersionRemotePromotionStatus['state']): string {
  if (state === 'running') return 'Pending remote promotion is already running.';
  if (state === 'pending') return 'Provider writes are pending.';
  if (state === 'unavailable') return 'Remote promotion is unavailable.';
  return '';
}

function firstPendingProviderWritesDiagnostic(
  surface: VersionSurfaceStatus,
): VersionDiagnostic | undefined {
  return [...surface.dirty.unsafeReasons, ...surface.dirty.diagnostics].find(
    (diagnostic) => diagnostic.code === 'version.surfaceStatus.pendingProviderWrites',
  );
}

function pendingRemoteCounts(data: Readonly<Record<string, JsonValue>> | undefined): {
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
