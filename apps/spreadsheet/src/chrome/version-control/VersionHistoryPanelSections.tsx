import { useState, type ReactNode, type RefObject } from 'react';
import {
  Check,
  ChevronRight,
  GitBranch,
  GitCommit,
  GitCompare,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import type {
  VersionAnnotationText,
  VersionRef,
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
import { displayBranchName, publicBranchLabel } from './version-branch-name';
import { shortCommitId } from './version-history-format';
import type { VersionHistoryData } from './version-history-panel-data';

export function VersionHistoryPanelHeader({
  branchControl,
  closeButtonRef,
  onClose,
  onRefresh,
  refreshDisabled,
  refreshInProgress,
}: {
  readonly branchControl?: ReactNode;
  readonly closeButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onClose: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly refreshDisabled: boolean;
  readonly refreshInProgress: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-2 py-1 border-b border-ss-border bg-ss-surface shrink-0">
      <div className="min-w-0 flex-1">{branchControl}</div>
      <button
        type="button"
        onClick={() => {
          void onRefresh();
        }}
        data-testid="panel-version-history-refresh"
        className="w-7 h-7 flex shrink-0 items-center justify-center rounded-full text-ss-text-secondary hover:bg-ss-surface-hover cursor-pointer transition-colors disabled:opacity-50"
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
        className="w-7 h-7 flex shrink-0 items-center justify-center rounded-full text-ss-text-secondary hover:bg-ss-surface-hover cursor-pointer transition-colors"
        aria-label="Close version history"
        title="Close"
      >
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}

export function CurrentBranchMenu({
  data,
  branchName,
  targetCommitId,
  branchEnabled,
  checkoutEnabled,
  branchDisabledReason,
  checkoutDisabledReason,
  onBranchNameChange,
  onCreateBranch,
  onCheckoutRef,
}: {
  readonly data: VersionHistoryData;
  readonly branchName: string;
  readonly targetCommitId?: WorkbookCommitId;
  readonly branchEnabled: boolean;
  readonly checkoutEnabled: boolean;
  readonly branchDisabledReason?: string;
  readonly checkoutDisabledReason?: string;
  readonly onBranchNameChange: (value: string) => void;
  readonly onCreateBranch: () => void;
  readonly onCheckoutRef: (ref: VersionRef) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const checkoutReasonId = 'version-checkout-disabled-reason';
  const branchReasonId = 'version-branch-disabled-reason';
  const checkoutStatus =
    sanitizeVersionStatusText(checkoutDisabledReason, 'Checkout is unavailable.') ??
    'Checkout is unavailable.';
  const branchStatus =
    sanitizeVersionStatusText(branchDisabledReason, 'Create branch is unavailable.') ??
    'Create branch is unavailable.';
  const currentBranchName = currentBranchRefName(data);
  const currentBranchLabel = currentBranchName
    ? displayBranchName(currentBranchName)
    : 'Detached or unavailable';
  const headId = data.head?.id ?? data.surface?.current.headCommitId;

  return (
    <section aria-label="Version status" className="relative min-w-0">
      <details
        open={open}
        className="group relative"
        data-testid="version-history-current-branch-menu"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary
          className="flex h-7 min-w-0 cursor-pointer list-none items-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2 text-body-sm [&::-webkit-details-marker]:hidden"
          data-testid="version-history-current-branch-trigger"
          tabIndex={0}
          aria-label={`Current branch ${currentBranchLabel}`}
        >
          <GitBranch
            size={15}
            strokeWidth={1.75}
            aria-hidden="true"
            className="shrink-0 text-ss-text-secondary"
          />
          <span className="shrink-0 text-[11px] font-medium uppercase text-ss-text-tertiary">
            Current branch
          </span>
          <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-ss-text">
            {currentBranchLabel}
          </span>
          <ChevronRight
            size={15}
            strokeWidth={1.75}
            aria-hidden="true"
            className="shrink-0 text-ss-text-tertiary transition-transform group-open:rotate-90"
          />
        </summary>

        {open ? (
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-sm border border-ss-border bg-ss-surface shadow-ss-md">
            <div className="border-b border-ss-border px-3 py-2">
              <div className="text-[11px] font-medium uppercase text-ss-text-tertiary">
                Latest commit
              </div>
              <div
                data-testid="version-history-current-commit"
                className="mt-0.5 font-mono text-xs text-ss-text"
              >
                {headId ? shortCommitId(headId) : 'Unavailable'}
              </div>
            </div>
            <div>
              <div className="px-3 py-3">
                <div className="mb-2 flex items-center gap-2 text-body-sm font-medium text-ss-text">
                  <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                  <span>New branch</span>
                </div>
                <label htmlFor="version-branch-name" className="sr-only">
                  Branch name
                </label>
                <input
                  id="version-branch-name"
                  data-testid="version-history-branch-name-input"
                  type="text"
                  value={branchName}
                  onChange={(event) => onBranchNameChange(event.currentTarget.value)}
                  placeholder="budget-forecast"
                  className="w-full rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-body-sm text-ss-text outline-none focus:border-ss-primary"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <TargetSummary
                    testId="version-history-branch-target-summary"
                    commitId={targetCommitId}
                  />
                  <button
                    type="button"
                    data-testid="version-history-create-branch-button"
                    onClick={onCreateBranch}
                    disabled={!branchEnabled}
                    aria-describedby={!branchEnabled && branchStatus ? branchReasonId : undefined}
                    title={!branchEnabled ? branchStatus : undefined}
                    className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
                  >
                    <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                    <span>Create branch</span>
                  </button>
                </div>
                <DisabledReason
                  id={branchReasonId}
                  reason={!branchEnabled ? branchStatus : undefined}
                />
              </div>

              <div className="border-t border-ss-border px-3 pb-2 pt-3">
                <div className="mb-2 text-[11px] font-medium uppercase text-ss-text-tertiary">
                  Branches
                </div>
                <DisabledReason
                  id={checkoutReasonId}
                  reason={!checkoutEnabled ? checkoutStatus : undefined}
                />
                {data.refs.length === 0 ? (
                  <div className="py-2 text-body-sm text-ss-text-secondary">
                    No branches available
                  </div>
                ) : (
                  <ol className="m-0 flex flex-col gap-1 p-0 list-none">
                    {data.refs.map((ref) => {
                      const branchLabel = displayBranchName(ref.name);
                      const current = isCurrentBranchRef(currentBranchName, ref);
                      const buttonLabel = current
                        ? `Current branch ${branchLabel}`
                        : `Checkout ${branchLabel}`;
                      return (
                        <li key={ref.name}>
                          <button
                            type="button"
                            data-testid={`version-history-checkout-branch-${safeDomId(ref.name)}`}
                            onClick={() => {
                              if (!current) onCheckoutRef(ref);
                            }}
                            disabled={current || !checkoutEnabled}
                            aria-label={buttonLabel}
                            aria-describedby={
                              !current && !checkoutEnabled ? checkoutReasonId : undefined
                            }
                            title={
                              current
                                ? 'Current branch'
                                : !checkoutEnabled
                                  ? checkoutStatus
                                  : undefined
                            }
                            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-sm px-2 py-1.5 text-left text-body-sm text-ss-text transition-colors hover:bg-ss-surface-hover disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{branchLabel}</span>
                              <span className="block truncate font-mono text-[11px] text-ss-text-secondary">
                                {shortCommitId(ref.commitId)}
                              </span>
                            </span>
                            {current ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ss-primary">
                                <Check size={13} strokeWidth={1.75} aria-hidden="true" />
                                Current
                              </span>
                            ) : (
                              <span className="text-[11px] font-medium text-ss-text-secondary">
                                Checkout
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </details>
    </section>
  );
}

export function VersionStatusAlerts({
  data,
}: {
  readonly data: VersionHistoryData;
}): React.JSX.Element {
  const hasUncommittedChanges = data.surface?.dirty.hasUncommittedLocalChanges === true;

  return (
    <>
      {hasUncommittedChanges ? (
        <div className="rounded-sm border border-ss-warning/40 bg-ss-warning/10 px-2 py-1.5 text-body-sm text-ss-text">
          Uncommitted changes
        </div>
      ) : null}
      <VersionCurrentStaleStatus surface={data.surface} />
    </>
  );
}

function currentBranchRefName(data: VersionHistoryData): string | undefined {
  if (data.surface?.current.detached) return undefined;
  const branchName = data.surface?.current.branchName ?? data.head?.refName;
  return branchName && publicBranchLabel(branchName) ? branchName : undefined;
}

function isCurrentBranchRef(currentBranchName: string | undefined, ref: VersionRef): boolean {
  if (!currentBranchName) return false;
  return displayBranchName(currentBranchName) === displayBranchName(ref.name);
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
      className="min-w-0 truncate font-mono text-[11px] text-ss-text-secondary"
      data-testid={testId}
      data-version-commit-id={commitId}
    >
      Target {commitId ? shortCommitId(commitId) : 'unavailable'}
    </span>
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
