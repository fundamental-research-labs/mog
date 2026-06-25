import type { RefObject } from 'react';
import { GitBranch, GitCommit, GitCompare, History, RefreshCw, X } from 'lucide-react';
import type {
  VersionAnnotationText,
  VersionCapability,
  VersionRef,
  VersionSurfaceStatus,
  WorkbookCommitId,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import {
  DisabledReason,
  safeDomId,
  sanitizeVersionStatusText,
} from './availability/version-action-availability';
import type { VersionPanelDiagnostic } from './VersionActionStatus';
import { VersionCurrentStaleStatus } from './VersionCurrentStaleStatus';
import { displayBranchName } from './version-branch-name';
import { shortCommitId } from './version-history-format';
import type { VersionHistoryData } from './version-history-panel-data';

const CAPABILITY_LABELS: Record<VersionCapability, string> = {
  'version:read': 'Read',
  'version:diff': 'Diff',
  'version:commit': 'Commit',
  'version:branch': 'Branch',
  'version:checkout': 'Checkout',
  'version:reviewRead': 'Review read',
  'version:reviewWrite': 'Review write',
  'version:proposal': 'Proposal',
  'version:mergePreview': 'Merge preview',
  'version:mergeApply': 'Merge apply',
  'version:revert': 'Revert',
  'version:provenance': 'Provenance',
  'version:remotePromote': 'Remote promote',
};

const CAPABILITY_ROWS = Object.keys(CAPABILITY_LABELS) as readonly VersionCapability[];
const CAPABILITY_ROW_INDEX = new Map(
  CAPABILITY_ROWS.map((capability, index) => [capability, index] as const),
);

function capabilityRows(surface?: VersionSurfaceStatus): readonly VersionCapability[] {
  if (!surface) return CAPABILITY_ROWS;

  return (Object.keys(surface.capabilities) as VersionCapability[]).sort(
    (left, right) =>
      (CAPABILITY_ROW_INDEX.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (CAPABILITY_ROW_INDEX.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function VersionHistoryPanelHeader({
  closeButtonRef,
  onClose,
  onRefresh,
  refreshDisabled,
  refreshInProgress,
}: {
  readonly closeButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onClose: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly refreshDisabled: boolean;
  readonly refreshInProgress: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-ss-border bg-ss-surface-secondary shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <History
          size={18}
          strokeWidth={1.75}
          aria-hidden="true"
          className="text-ss-primary shrink-0"
        />
        <h2 className="text-subtitle font-semibold text-ss-text m-0 truncate">Version History</h2>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            void onRefresh();
          }}
          data-testid="panel-version-history-refresh"
          className="w-7 h-7 flex items-center justify-center rounded-full text-ss-text-secondary hover:bg-ss-surface-hover cursor-pointer transition-colors disabled:opacity-50"
          aria-label="Refresh version history"
          aria-busy={refreshInProgress}
          title="Refresh"
          disabled={refreshDisabled}
        >
          <RefreshCw size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          data-testid="panel-version-history-close"
          className="w-7 h-7 flex items-center justify-center rounded-full text-ss-text-secondary hover:bg-ss-surface-hover cursor-pointer transition-colors"
          aria-label="Close version history"
          title="Close"
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function VersionStatusSummary({
  data,
}: {
  readonly data: VersionHistoryData;
}): React.JSX.Element {
  const headId = data.head?.id ?? data.surface?.current.headCommitId;
  const branchName = data.surface?.current.detached
    ? undefined
    : (data.surface?.current.branchName ?? data.head?.refName);
  const branchLabel = branchName ? displayBranchName(branchName) : 'Detached or unavailable';
  const storageLabel = data.surface
    ? `${data.surface.storage.backend}${data.surface.storage.ready ? ' ready' : ' unavailable'}`
    : 'Unknown';
  const dirtyLabel = data.surface?.dirty.hasUncommittedLocalChanges
    ? 'Uncommitted changes'
    : 'Clean';

  return (
    <section className="flex flex-col gap-2" aria-label="Version status">
      <div className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-body-sm">
        <span className="text-ss-text-secondary">Stage</span>
        <span className="text-ss-text font-medium">
          {data.surface?.stage ?? data.rollout?.rolloutStage ?? 'Unknown'}
        </span>
        <span className="text-ss-text-secondary">Storage</span>
        <span className="text-ss-text">{storageLabel}</span>
        <span className="text-ss-text-secondary">Branch</span>
        <span className="text-ss-text truncate">{branchLabel}</span>
        <span className="text-ss-text-secondary">Head</span>
        <span className="font-mono text-xs text-ss-text truncate">
          {headId ? shortCommitId(headId) : 'Unavailable'}
        </span>
        <span className="text-ss-text-secondary">Workspace</span>
        <span className="text-ss-text">{dirtyLabel}</span>
      </div>
      <VersionCurrentStaleStatus surface={data.surface} />
    </section>
  );
}

export function CapabilitySummary({
  surface,
}: {
  readonly surface?: VersionSurfaceStatus;
}): React.JSX.Element {
  const rows = capabilityRows(surface).map((capability) => ({
    capability,
    state: surface?.capabilities[capability],
  }));

  return (
    <section className="flex flex-wrap gap-1.5" aria-label="Version capabilities">
      {rows.map(({ capability, state }) => {
        const enabled = state?.enabled === true;
        const reason =
          sanitizeVersionStatusText(
            state?.enabled === false ? state.reason : 'Unavailable',
            'Unavailable',
          ) ?? 'Unavailable';
        const description = enabled
          ? `${CAPABILITY_LABELS[capability]} enabled`
          : `${CAPABILITY_LABELS[capability]} unavailable: ${reason}`;
        return (
          <span
            key={capability}
            data-testid={`version-history-capability-${safeDomId(capability)}`}
            data-state={enabled ? 'enabled' : 'unavailable'}
            aria-label={description}
            className={`px-2 py-1 rounded-sm text-[11px] leading-none border ${
              enabled
                ? 'border-ss-success/40 text-ss-success bg-ss-success/10'
                : 'border-ss-border text-ss-text-secondary bg-ss-surface-secondary'
            }`}
            title={description}
          >
            {CAPABILITY_LABELS[capability]}
            <span className="sr-only">{enabled ? ' enabled' : ` unavailable: ${reason}`}</span>
          </span>
        );
      })}
    </section>
  );
}

export function RefList({
  refs,
  checkoutEnabled,
  checkoutDisabledReason,
  onCheckoutRef,
}: {
  readonly refs: readonly VersionRef[];
  readonly checkoutEnabled: boolean;
  readonly checkoutDisabledReason?: string;
  readonly onCheckoutRef: (ref: VersionRef) => void;
}): React.JSX.Element {
  const checkoutReasonId = 'version-checkout-disabled-reason';
  const checkoutStatus = checkoutDisabledReason?.trim() || 'Checkout is unavailable.';

  return (
    <section className="flex flex-col gap-2" aria-label="Branches">
      <div className="flex items-center gap-2 text-body-sm font-semibold text-ss-text">
        <GitBranch size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>Branches</span>
      </div>
      <DisabledReason
        id={checkoutReasonId}
        reason={!checkoutEnabled ? checkoutStatus : undefined}
      />
      {refs.length === 0 ? (
        <div className="text-body-sm text-ss-text-secondary py-2">No branches available</div>
      ) : (
        <ol className="flex flex-col gap-2 m-0 p-0 list-none">
          {refs.map((ref) => {
            const branchLabel = displayBranchName(ref.name);
            return (
              <li key={ref.name} className="border border-ss-border rounded-sm p-2 bg-ss-surface">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-body-sm font-medium text-ss-text truncate">
                      {branchLabel}
                    </div>
                    <div className="font-mono text-[11px] text-ss-text-secondary truncate">
                      {shortCommitId(ref.commitId)}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid={`version-history-checkout-branch-${safeDomId(ref.name)}`}
                    onClick={() => onCheckoutRef(ref)}
                    disabled={!checkoutEnabled}
                    aria-label={`Checkout ${branchLabel}`}
                    aria-describedby={!checkoutEnabled ? checkoutReasonId : undefined}
                    title={!checkoutEnabled ? checkoutStatus : undefined}
                    className="inline-flex h-7 shrink-0 items-center justify-center rounded-sm border border-ss-border bg-ss-surface-secondary px-2 text-[11px] font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
                  >
                    Checkout
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function CommitList({
  commits,
  selectedCommitId,
  diffEnabled,
  diffDisabledReason,
  onSelectCommit,
  onDiffCommit,
}: {
  readonly commits: readonly WorkbookCommitSummary[];
  readonly selectedCommitId?: WorkbookCommitId;
  readonly diffEnabled: boolean;
  readonly diffDisabledReason?: string;
  readonly onSelectCommit: (commitId: WorkbookCommitId) => void;
  readonly onDiffCommit: (commit: WorkbookCommitSummary) => void;
}): React.JSX.Element {
  const diffReasonId = 'version-diff-disabled-reason';

  return (
    <section className="flex flex-col gap-2" aria-label="Recent commits">
      <div className="flex items-center gap-2 text-body-sm font-semibold text-ss-text">
        <GitCommit size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>Recent Commits</span>
      </div>
      <DisabledReason id={diffReasonId} reason={!diffEnabled ? diffDisabledReason : undefined} />
      {commits.length === 0 ? (
        <div className="text-body-sm text-ss-text-secondary py-2">No commits available</div>
      ) : (
        <ol className="flex flex-col gap-2 m-0 p-0 list-none">
          {commits.map((commit) => {
            const rootDiffReason =
              commit.parents.length === 0 ? 'Root commits do not have a parent diff.' : undefined;
            const commitDiffEnabled = diffEnabled && !rootDiffReason;
            const commitDiffReasonId = `version-diff-disabled-${safeDomId(commit.id)}`;
            const describedBy = !diffEnabled
              ? diffReasonId
              : rootDiffReason
                ? commitDiffReasonId
                : undefined;
            const buttonTitle = !diffEnabled ? diffDisabledReason : rootDiffReason;
            const commitTestId = safeDomId(commit.id);

            return (
              <li
                key={commit.id}
                className={`border rounded-sm p-2 bg-ss-surface ${
                  selectedCommitId === commit.id ? 'border-ss-primary' : 'border-ss-border'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-body-sm font-medium text-ss-text truncate">
                      {annotationText(commit.annotation?.title) ??
                        annotationText(commit.annotation?.message) ??
                        shortCommitId(commit.id)}
                    </div>
                    <div className="font-mono text-[11px] text-ss-text-secondary truncate">
                      {shortCommitId(commit.id)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <time
                      className="text-[11px] text-ss-text-secondary"
                      dateTime={commit.createdAt}
                    >
                      {formatCommitTime(commit.createdAt)}
                    </time>
                    <span className="text-[11px] font-medium text-ss-text-secondary">Target</span>
                    <input
                      type="radio"
                      name="version-history-branch-target"
                      data-testid={`version-history-branch-target-${commitTestId}`}
                      checked={selectedCommitId === commit.id}
                      onChange={() => onSelectCommit(commit.id)}
                      aria-label={`Use ${shortCommitId(commit.id)} as branch target`}
                      className="h-3.5 w-3.5 accent-ss-primary"
                    />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="min-w-0 text-[11px] text-ss-text-secondary truncate">
                    {commit.author.displayName ?? commit.author.actorKind ?? 'Unknown author'}
                  </div>
                  <button
                    type="button"
                    data-testid={`version-history-parent-diff-button-${commitTestId}`}
                    onClick={() => onDiffCommit(commit)}
                    disabled={!commitDiffEnabled}
                    aria-label={`Diff ${shortCommitId(commit.id)} against parent`}
                    aria-describedby={describedBy}
                    title={buttonTitle}
                    className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-sm border border-ss-border bg-ss-surface-secondary px-2 text-[11px] font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
                  >
                    <GitCompare size={13} strokeWidth={1.75} aria-hidden="true" />
                    <span>Diff</span>
                  </button>
                </div>
                {diffEnabled ? (
                  <DisabledReason id={commitDiffReasonId} reason={rootDiffReason} />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function DiagnosticsBlock({
  diagnostics,
  emptyMessage,
}: {
  readonly diagnostics: readonly VersionPanelDiagnostic[];
  readonly emptyMessage?: string;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2 p-4" aria-label="Version diagnostics">
      {emptyMessage ? (
        <div className="text-body-sm font-medium text-ss-text">{emptyMessage}</div>
      ) : null}
      {diagnostics.map((diagnostic, index) => (
        <div
          key={`${diagnostic.code}-${index}`}
          className="border border-ss-border rounded-sm px-3 py-2 bg-ss-surface-secondary"
        >
          <div className="text-[11px] uppercase text-ss-text-tertiary">{diagnostic.severity}</div>
          <div className="text-body-sm text-ss-text">{diagnostic.message}</div>
        </div>
      ))}
    </section>
  );
}

function annotationText(value: VersionAnnotationText | undefined): string | undefined {
  return value ? (value.kind === 'text' ? value.value : 'Redacted') : undefined;
}

function formatCommitTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
