import { useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Check,
  ChevronRight,
  GitBranch,
  GitCommit,
  GitCompare,
  MoreHorizontal,
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
  createVirtualRef,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@mog/shell';

import {
  DisabledReason,
  safeDomId,
  sanitizeVersionStatusText,
  type VersionActionAvailability,
} from './availability/version-action-availability';
import type { VersionPanelDiagnostic } from './VersionActionStatus';
import { VersionCurrentStaleStatus } from './VersionCurrentStaleStatus';
import { VersionHistoryWorkingTreeDiffPreview } from './VersionHistoryDiffPreview';
import { displayBranchName, publicBranchLabel } from './version-branch-name';
import { formatRelativeCommitTime, shortCommitId } from './version-history-format';
import type {
  VersionHistoryData,
  VersionHistoryWorkingTreeDiff,
} from './version-history-panel-data';

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
  sourceCommitId,
  branchEnabled,
  checkoutEnabled,
  mergePreviewEnabled,
  branchDisabledReason,
  checkoutDisabledReason,
  mergePreviewDisabledReason,
  onBranchNameChange,
  onCreateBranch,
  onCheckoutRef,
  onPreviewMerge,
}: {
  readonly data: VersionHistoryData;
  readonly branchName: string;
  readonly sourceCommitId?: WorkbookCommitId;
  readonly branchEnabled: boolean;
  readonly checkoutEnabled: boolean;
  readonly mergePreviewEnabled: boolean;
  readonly branchDisabledReason?: string;
  readonly checkoutDisabledReason?: string;
  readonly mergePreviewDisabledReason?: string;
  readonly onBranchNameChange: (value: string) => void;
  readonly onCreateBranch: () => void;
  readonly onCheckoutRef: (ref: VersionRef) => void;
  readonly onPreviewMerge: (ref: VersionRef) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const checkoutReasonId = 'version-checkout-disabled-reason';
  const branchReasonId = 'version-branch-disabled-reason';
  const mergePreviewReasonId = 'version-merge-preview-disabled-reason';
  const checkoutStatus =
    sanitizeVersionStatusText(checkoutDisabledReason, 'Checkout is unavailable.') ??
    'Checkout is unavailable.';
  const branchStatus =
    sanitizeVersionStatusText(branchDisabledReason, 'Create branch is unavailable.') ??
    'Create branch is unavailable.';
  const mergePreviewStatus =
    sanitizeVersionStatusText(mergePreviewDisabledReason, 'Merge preview is unavailable.') ??
    'Merge preview is unavailable.';
  const currentBranchName = currentBranchRefName(data);
  const currentCheckout = currentCheckoutSummary(data, currentBranchName);
  const headId = data.head?.id ?? data.surface?.current.headCommitId;

  return (
    <section
      aria-label="Version status"
      className="relative min-w-0"
      data-testid="version-history-current-branch-menu"
      data-state={open ? 'open' : 'closed'}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-7 w-full min-w-0 cursor-pointer list-none items-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2 text-body-sm"
            data-testid="version-history-current-branch-trigger"
            aria-label={currentCheckout.ariaLabel}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <GitBranch
              size={15}
              strokeWidth={1.75}
              aria-hidden="true"
              className="shrink-0 text-ss-text-secondary"
            />
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="shrink-0 text-[11px] font-medium text-ss-text-tertiary">
                {currentCheckout.statusLabel}
              </span>
              <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-ss-text">
                {currentCheckout.label}
              </span>
            </span>
            <ChevronRight
              size={15}
              strokeWidth={1.75}
              aria-hidden="true"
              className={`shrink-0 text-ss-text-tertiary transition-transform ${
                open ? 'rotate-90' : ''
              }`}
            />
          </button>
        </PopoverTrigger>

        {open ? (
          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={4}
            width="var(--radix-popover-trigger-width)"
            role="dialog"
            aria-label="Current branch"
            data-testid="version-history-current-branch-popover"
            className="z-50 overflow-hidden rounded-sm border border-ss-border bg-ss-surface p-0 shadow-ss-md"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
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
                  <BranchSourceSummary
                    testId="version-history-branch-source-summary"
                    commitId={sourceCommitId}
                  />
                  <button
                    type="button"
                    data-testid="version-history-create-branch-button"
                    onClick={() => onCreateBranch()}
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
                        <li
                          key={ref.name}
                          data-testid={`version-history-branch-row-${safeDomId(ref.name)}`}
                        >
                          <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-sm px-2 py-1.5 text-left text-body-sm text-ss-text transition-colors hover:bg-ss-surface-hover">
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{branchLabel}</span>
                              <span className="block truncate font-mono text-[11px] text-ss-text-secondary">
                                {shortCommitId(ref.commitId)}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              {!current ? (
                                <button
                                  type="button"
                                  data-testid={`version-history-preview-merge-${safeDomId(
                                    ref.name,
                                  )}`}
                                  data-capability="version:mergePreview"
                                  onClick={() => onPreviewMerge(ref)}
                                  disabled={!mergePreviewEnabled}
                                  aria-describedby={
                                    !mergePreviewEnabled ? mergePreviewReasonId : undefined
                                  }
                                  title={!mergePreviewEnabled ? mergePreviewStatus : undefined}
                                  className="inline-flex h-7 items-center justify-center rounded-sm px-2 text-[11px] font-medium text-ss-text-secondary transition-colors hover:bg-ss-surface-hover hover:text-ss-text disabled:opacity-50 disabled:hover:bg-transparent"
                                >
                                  Preview merge
                                </button>
                              ) : null}
                              <button
                                type="button"
                                data-testid={`version-history-checkout-branch-${safeDomId(
                                  ref.name,
                                )}`}
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
                                className="inline-flex h-7 items-center justify-center rounded-sm px-2 text-[11px] font-medium text-ss-text-secondary transition-colors hover:bg-ss-surface-hover hover:text-ss-text disabled:opacity-70 disabled:hover:bg-transparent"
                              >
                                {current ? (
                                  <span className="inline-flex items-center gap-1 text-ss-primary">
                                    <Check size={13} strokeWidth={1.75} aria-hidden="true" />
                                    Current
                                  </span>
                                ) : (
                                  'Checkout'
                                )}
                              </button>
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
                <DisabledReason
                  id={mergePreviewReasonId}
                  reason={!mergePreviewEnabled ? mergePreviewStatus : undefined}
                />
              </div>
            </div>
          </PopoverContent>
        ) : null}
      </Popover>
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

export function WorkingTreeDiffSection({
  diff,
}: {
  readonly diff?: VersionHistoryWorkingTreeDiff;
}): React.JSX.Element | null {
  if (!diff) return null;
  if (diff.status === 'loaded') {
    return <VersionHistoryWorkingTreeDiffPreview page={diff.page} />;
  }

  return (
    <section
      className="flex flex-col gap-2 rounded-sm border border-ss-warning/40 bg-ss-warning/10 p-2.5"
      aria-label="Working tree diff"
      data-testid="version-history-working-tree-diff-blocked"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ss-text">
        <GitCompare size={15} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
        <span>Working tree diff</span>
      </div>
      <DiagnosticsBlock
        diagnostics={[diff.diagnostic]}
        emptyMessage="Working tree diff unavailable"
      />
    </section>
  );
}

function currentBranchRefName(data: VersionHistoryData): string | undefined {
  if (data.surface?.current.detached) return undefined;
  const branchName = data.surface?.current.branchName ?? data.head?.refName;
  return branchName && publicBranchLabel(branchName) ? branchName : undefined;
}

function currentCheckoutSummary(
  data: VersionHistoryData,
  currentBranchName: string | undefined,
): {
  readonly statusLabel: string;
  readonly label: string;
  readonly ariaLabel: string;
} {
  if (currentBranchName) {
    const label = displayBranchName(currentBranchName);
    return { statusLabel: 'Current branch', label, ariaLabel: `Current branch ${label}` };
  }

  const commitId =
    data.surface?.current.checkedOutCommitId ?? data.surface?.current.headCommitId ?? data.head?.id;
  if (data.surface?.current.detached) {
    if (commitId) {
      const label = `Detached at ${shortCommitId(commitId)}`;
      return { statusLabel: 'Current checkout', label, ariaLabel: `Current checkout ${label}` };
    }
    return {
      statusLabel: 'Current checkout',
      label: 'Detached checkout',
      ariaLabel: 'Current checkout detached',
    };
  }

  if (commitId) {
    const label = shortCommitId(commitId);
    return { statusLabel: 'Current checkout', label, ariaLabel: `Current checkout ${label}` };
  }

  return {
    statusLabel: 'Current checkout',
    label: 'Unavailable',
    ariaLabel: 'Current checkout unavailable',
  };
}

function isCurrentBranchRef(currentBranchName: string | undefined, ref: VersionRef): boolean {
  if (!currentBranchName) return false;
  return displayBranchName(currentBranchName) === displayBranchName(ref.name);
}

function BranchSourceSummary({
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
      From current checkout {commitId ? shortCommitId(commitId) : 'unavailable'}
    </span>
  );
}

export function CommitList({
  activeParentDiffCommitId,
  branchName,
  commits,
  checkoutEnabled,
  checkoutDisabledReason,
  diffEnabled,
  diffDisabledReason,
  getBranchAvailabilityForCommit,
  onBranchNameChange,
  onCheckoutCommit,
  onCreateBranchFromCommit,
  onDiffCommit,
}: {
  readonly activeParentDiffCommitId?: WorkbookCommitId;
  readonly branchName: string;
  readonly commits: readonly WorkbookCommitSummary[];
  readonly checkoutEnabled: boolean;
  readonly checkoutDisabledReason?: string;
  readonly diffEnabled: boolean;
  readonly diffDisabledReason?: string;
  readonly getBranchAvailabilityForCommit: (
    commitId: WorkbookCommitId,
  ) => VersionActionAvailability;
  readonly onBranchNameChange: (value: string) => void;
  readonly onCheckoutCommit: (commitId: WorkbookCommitId) => void;
  readonly onCreateBranchFromCommit: (commitId: WorkbookCommitId) => void;
  readonly onDiffCommit: (commit: WorkbookCommitSummary) => void;
}): React.JSX.Element {
  const [contextMenu, setContextMenu] = useState<CommitContextMenuState | undefined>();
  const diffReasonId = 'version-diff-disabled-reason';
  const checkoutReasonId = 'version-commit-checkout-disabled-reason';
  const checkoutStatus =
    sanitizeVersionStatusText(checkoutDisabledReason, 'Checkout is unavailable.') ??
    'Checkout is unavailable.';

  const openCommitMenu = (
    commit: WorkbookCommitSummary,
    point: { readonly x: number; readonly y: number },
  ) => {
    setContextMenu({
      commit,
      mode: 'actions',
      x: Math.max(8, point.x),
      y: Math.max(8, point.y),
    });
  };

  const beginBranchFromCommit = (commit: WorkbookCommitSummary) => {
    onBranchNameChange('');
    setContextMenu((current) =>
      current && current.commit.id === commit.id
        ? { ...current, mode: 'branch' }
        : { commit, mode: 'branch', x: 24, y: 96 },
    );
  };

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
        <ol className="flex flex-col gap-1.5 m-0 p-0 list-none">
          {commits.map((commit) => {
            const rootDiffReason =
              commit.parents.length === 0 ? 'Root commits do not have a parent diff.' : undefined;
            const parentDiffActive = activeParentDiffCommitId === commit.id;
            const commitDiffEnabled = (diffEnabled || parentDiffActive) && !rootDiffReason;
            const describedBy =
              !commitDiffEnabled && !diffEnabled && !parentDiffActive ? diffReasonId : undefined;
            const buttonTitle =
              !commitDiffEnabled && !diffEnabled && !parentDiffActive
                ? diffDisabledReason
                : parentDiffActive
                  ? 'Hide diff'
                  : undefined;
            const commitTestId = safeDomId(commit.id);
            const menuOpen = contextMenu?.commit.id === commit.id;
            const diffButtonLabel = parentDiffActive ? 'Hide' : 'Diff';

            return (
              <li
                key={commit.id}
                data-testid={`version-history-commit-row-${commitTestId}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openCommitMenu(commit, { x: event.clientX, y: event.clientY });
                }}
                className={`border rounded-sm bg-ss-surface px-2 py-1.5 ${
                  menuOpen ? 'border-ss-primary' : 'border-ss-border'
                }`}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-body-sm font-medium leading-4 text-ss-text">
                        {annotationText(commit.annotation?.title) ??
                          annotationText(commit.annotation?.message) ??
                          shortCommitId(commit.id)}
                      </div>
                      <time
                        className="shrink-0 whitespace-nowrap text-[11px] leading-4 text-ss-text-secondary"
                        dateTime={commit.createdAt}
                      >
                        {formatRelativeCommitTime(commit.createdAt)}
                      </time>
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-3 text-ss-text-secondary">
                      <span className="shrink-0 truncate font-mono">
                        {shortCommitId(commit.id)}
                      </span>
                      <span aria-hidden="true" className="shrink-0">
                        |
                      </span>
                      <span className="min-w-0 truncate">
                        {commit.author.displayName ?? commit.author.actorKind ?? 'Unknown author'}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      data-testid={`version-history-parent-diff-button-${commitTestId}`}
                      onClick={() => onDiffCommit(commit)}
                      disabled={!commitDiffEnabled}
                      aria-label={
                        parentDiffActive
                          ? `Hide diff ${shortCommitId(commit.id)} against parent`
                          : `Diff ${shortCommitId(commit.id)} against parent`
                      }
                      aria-pressed={parentDiffActive}
                      aria-describedby={describedBy}
                      title={buttonTitle}
                      className="inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-sm border border-ss-border bg-ss-surface-secondary px-1.5 text-[11px] font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
                    >
                      <GitCompare size={12} strokeWidth={1.75} aria-hidden="true" />
                      <span>{diffButtonLabel}</span>
                    </button>
                    <button
                      type="button"
                      data-testid={`version-history-commit-menu-button-${commitTestId}`}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        openCommitMenu(commit, {
                          x: rect.right || event.clientX,
                          y: rect.bottom || event.clientY,
                        });
                      }}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      aria-label={`Open actions for ${shortCommitId(commit.id)}`}
                      title="Commit actions"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-ss-text-secondary transition-colors hover:bg-ss-surface-hover hover:text-ss-text"
                    >
                      <MoreHorizontal size={14} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {contextMenu ? (
        <CommitContextMenu
          state={contextMenu}
          branchName={branchName}
          branchAvailability={getBranchAvailabilityForCommit(contextMenu.commit.id)}
          checkoutEnabled={checkoutEnabled}
          checkoutReasonId={checkoutReasonId}
          checkoutStatus={checkoutStatus}
          activeParentDiffCommitId={activeParentDiffCommitId}
          diffEnabled={diffEnabled}
          diffDisabledReason={diffDisabledReason}
          onBranchNameChange={onBranchNameChange}
          onBeginBranch={() => beginBranchFromCommit(contextMenu.commit)}
          onClose={() => setContextMenu(undefined)}
          onCancelBranch={() =>
            setContextMenu((current) => (current ? { ...current, mode: 'actions' } : current))
          }
          onCheckoutCommit={() => {
            const commitId = contextMenu.commit.id;
            setContextMenu(undefined);
            onCheckoutCommit(commitId);
          }}
          onCreateBranch={() => {
            const commitId = contextMenu.commit.id;
            setContextMenu(undefined);
            onCreateBranchFromCommit(commitId);
          }}
          onDiffCommit={() => {
            const commit = contextMenu.commit;
            setContextMenu(undefined);
            onDiffCommit(commit);
          }}
        />
      ) : null}
    </section>
  );
}

type CommitContextMenuState = {
  readonly commit: WorkbookCommitSummary;
  readonly mode: 'actions' | 'branch';
  readonly x: number;
  readonly y: number;
};

function CommitContextMenu({
  state,
  activeParentDiffCommitId,
  branchName,
  branchAvailability,
  checkoutEnabled,
  checkoutReasonId,
  checkoutStatus,
  diffEnabled,
  diffDisabledReason,
  onBranchNameChange,
  onBeginBranch,
  onClose,
  onCancelBranch,
  onCheckoutCommit,
  onCreateBranch,
  onDiffCommit,
}: {
  readonly state: CommitContextMenuState;
  readonly activeParentDiffCommitId?: WorkbookCommitId;
  readonly branchName: string;
  readonly branchAvailability: VersionActionAvailability;
  readonly checkoutEnabled: boolean;
  readonly checkoutReasonId: string;
  readonly checkoutStatus: string;
  readonly diffEnabled: boolean;
  readonly diffDisabledReason?: string;
  readonly onBranchNameChange: (value: string) => void;
  readonly onBeginBranch: () => void;
  readonly onClose: () => void;
  readonly onCancelBranch: () => void;
  readonly onCheckoutCommit: () => void;
  readonly onCreateBranch: () => void;
  readonly onDiffCommit: () => void;
}): React.JSX.Element {
  const virtualRef = useRef(createVirtualRef(state.x, state.y));
  virtualRef.current = createVirtualRef(state.x, state.y);
  const commitId = state.commit.id;
  const shortId = shortCommitId(commitId);
  const commitTestId = safeDomId(commitId);
  const rootDiffReason =
    state.commit.parents.length === 0 ? 'Root commits do not have a parent diff.' : undefined;
  const parentDiffActive = activeParentDiffCommitId === state.commit.id;
  const commitDiffEnabled = (diffEnabled || parentDiffActive) && !rootDiffReason;
  const contextDiffReasonId = `version-context-diff-disabled-${commitTestId}`;
  const diffStatus =
    parentDiffActive
      ? 'Hide diff'
      : (sanitizeVersionStatusText(
          !diffEnabled ? diffDisabledReason : rootDiffReason,
          'Diff is unavailable.',
        ) ?? 'Diff is unavailable.');
  const branchReasonId = `version-commit-branch-disabled-${commitTestId}`;

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  if (state.mode === 'branch') {
    const branchStatus =
      sanitizeVersionStatusText(
        branchAvailability.disabledReason,
        'Create branch is unavailable.',
      ) ?? 'Create branch is unavailable.';

    return (
      <Popover open={true} onOpenChange={handleOpenChange}>
        <PopoverAnchor virtualRef={virtualRef} />
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={0}
          width={260}
          role="dialog"
          aria-label={`Create branch from ${shortId}`}
          data-testid="version-history-commit-context-menu"
          data-commit-id={commitId}
          className="p-2"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (branchAvailability.enabled) onCreateBranch();
            }}
          >
            <div className="min-w-0">
              <div className="truncate text-body-sm font-medium text-ss-text">
                Create branch from commit
              </div>
              <div className="truncate font-mono text-[11px] text-ss-text-secondary">{shortId}</div>
            </div>
            <label htmlFor={`version-commit-branch-name-${commitTestId}`} className="sr-only">
              Branch name
            </label>
            <input
              id={`version-commit-branch-name-${commitTestId}`}
              data-testid={`version-history-commit-branch-name-input-${commitTestId}`}
              type="text"
              value={branchName}
              onChange={(event) => onBranchNameChange(event.currentTarget.value)}
              placeholder="budget-forecast"
              autoFocus
              className="w-full rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-body-sm text-ss-text outline-none focus:border-ss-primary"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onCancelBranch}
                className="inline-flex h-7 items-center justify-center rounded-sm px-2 text-body-sm text-ss-text-secondary transition-colors hover:bg-ss-surface-hover hover:text-ss-text"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid={`version-history-create-branch-from-commit-submit-${commitTestId}`}
                disabled={!branchAvailability.enabled}
                aria-describedby={!branchAvailability.enabled ? branchReasonId : undefined}
                title={!branchAvailability.enabled ? branchStatus : undefined}
                className="inline-flex h-7 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
              >
                <Plus size={13} strokeWidth={1.75} aria-hidden="true" />
                <span>Create branch</span>
              </button>
            </div>
            <DisabledReason
              id={branchReasonId}
              reason={!branchAvailability.enabled ? branchStatus : undefined}
            />
          </form>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover open={true} onOpenChange={handleOpenChange}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={0}
        width={236}
        role="menu"
        aria-label={`Commit actions for ${shortId}`}
        data-testid="version-history-commit-context-menu"
        data-commit-id={commitId}
        className="p-1"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <button
          type="button"
          role="menuitem"
          data-testid={`version-history-checkout-commit-${commitTestId}`}
          onClick={onCheckoutCommit}
          disabled={!checkoutEnabled}
          aria-describedby={!checkoutEnabled ? checkoutReasonId : undefined}
          title={!checkoutEnabled ? checkoutStatus : undefined}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-body-sm text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <GitCommit size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">Checkout commit</span>
        </button>
        <button
          type="button"
          role="menuitem"
          data-testid={`version-history-create-branch-from-commit-${commitTestId}`}
          onClick={onBeginBranch}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-body-sm text-ss-text transition-colors hover:bg-ss-surface-hover"
        >
          <GitBranch size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">Create branch from commit</span>
        </button>
        <button
          type="button"
          role="menuitem"
          data-testid={`version-history-context-diff-${commitTestId}`}
          onClick={onDiffCommit}
          disabled={!commitDiffEnabled}
          aria-describedby={!commitDiffEnabled ? contextDiffReasonId : undefined}
          title={!commitDiffEnabled || parentDiffActive ? diffStatus : undefined}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-body-sm text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <GitCompare size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            {parentDiffActive ? 'Hide parent diff' : 'Diff against parent'}
          </span>
        </button>
        <DisabledReason
          id={checkoutReasonId}
          reason={!checkoutEnabled ? checkoutStatus : undefined}
        />
        <DisabledReason
          id={contextDiffReasonId}
          reason={!commitDiffEnabled ? diffStatus : undefined}
        />
      </PopoverContent>
    </Popover>
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
