import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, GitCommit, GitCompare, History, RefreshCw, X } from 'lucide-react';
import type {
  AgentProposalSummary,
  Paged,
  VersionAnnotationText,
  VersionCapability,
  VersionError,
  VersionHead,
  VersionRef,
  VersionRevertInput,
  VersionRevertResult,
  VersionResult,
  VersionSurfaceStatus,
  WorkbookCommitId,
  WorkbookCommitSummary,
  WorkbookVersion,
  WorkbookVersionReviewRecordSummary,
  WorkbookVersionStatus,
} from '@mog-sdk/contracts/api';

import { useWorkbook } from '../../internal-api';
import {
  DisabledReason,
  getBranchAvailability,
  getCheckoutAvailability,
  getCommitAvailability,
  getDiffAvailability,
  getRollbackAvailability,
  isCapabilityEnabled,
  safeDomId,
} from './version-action-availability';
import {
  VersionActions,
  type VersionActionState,
  type VersionPanelDiagnostic,
} from './VersionActionStatus';
import { VersionHistoryDiffPreview, type VersionDiffPreview } from './VersionHistoryDiffPreview';
import { VersionCurrentStaleStatus } from './VersionCurrentStaleStatus';
import { ReviewProposalSurface, type ReviewProposalDiffTarget } from './ReviewProposalSurface';
import { useVersionPanelFocusTrap } from './useVersionPanelFocusTrap';
import { displayBranchName, normalizeVersionBranchNameInput } from './version-branch-name';
import { shortCommitId } from './version-history-format';

const COMMIT_PAGE_SIZE = 20;
const REVIEW_PAGE_SIZE = 5;
const PROPOSAL_PAGE_SIZE = 5;

const CAPABILITY_ROWS: readonly VersionCapability[] = [
  'version:read',
  'version:diff',
  'version:commit',
  'version:branch',
  'version:checkout',
  'version:revert',
  'version:reviewRead',
  'version:reviewWrite',
];

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

export interface VersionHistoryPanelProps {
  readonly onClose: () => void;
}

export interface VersionHistoryPanelContentProps {
  readonly workbook: VersionHistoryWorkbook;
  readonly onClose: () => void;
}

export type VersionHistoryWorkbook = {
  readonly version: Pick<
    WorkbookVersion,
    | 'getSurfaceStatus'
    | 'getStatus'
    | 'getHead'
    | 'listCommits'
    | 'commit'
    | 'listRefs'
    | 'createBranch'
    | 'checkout'
    | 'revert'
    | 'diff'
    | 'listReviews'
    | 'listProposals'
  >;
};

type VersionHistoryLoadState =
  | { readonly status: 'loading'; readonly previous?: VersionHistoryData }
  | { readonly status: 'ready'; readonly data: VersionHistoryData }
  | { readonly status: 'error'; readonly diagnostics: readonly VersionPanelDiagnostic[] };

type VersionHistoryData = {
  readonly surface?: VersionSurfaceStatus;
  readonly rollout?: WorkbookVersionStatus;
  readonly head?: VersionHead;
  readonly commits: readonly WorkbookCommitSummary[];
  readonly refs: readonly VersionRef[];
  readonly reviews: readonly WorkbookVersionReviewRecordSummary[];
  readonly proposals: readonly AgentProposalSummary[];
  readonly reviewDiagnostic?: VersionPanelDiagnostic;
  readonly proposalDiagnostic?: VersionPanelDiagnostic;
  readonly diagnostics: readonly VersionPanelDiagnostic[];
};

export function VersionHistoryPanel({ onClose }: VersionHistoryPanelProps): React.JSX.Element {
  const workbook = useWorkbook();
  return <VersionHistoryPanelContent workbook={workbook} onClose={onClose} />;
}

export function VersionHistoryPanelContent({
  workbook,
  onClose,
}: VersionHistoryPanelContentProps): React.JSX.Element {
  const [loadState, setLoadState] = useState<VersionHistoryLoadState>({ status: 'loading' });
  const [commitMessage, setCommitMessage] = useState('');
  const [branchName, setBranchName] = useState('');
  const [rollbackReason, setRollbackReason] = useState('');
  const [selectedCommitId, setSelectedCommitId] = useState<WorkbookCommitId | undefined>();
  const [actionState, setActionState] = useState<VersionActionState>({ status: 'idle' });
  const [diffPreview, setDiffPreview] = useState<VersionDiffPreview | undefined>();
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    setLoadState((current) => ({
      status: 'loading',
      previous:
        current.status === 'ready'
          ? current.data
          : current.status === 'loading'
            ? current.previous
            : undefined,
    }));

    const diagnostics: VersionPanelDiagnostic[] = [];
    const surface = await readValue('VERSION_UI_SURFACE_STATUS_FAILED', () =>
      workbook.version.getSurfaceStatus(),
    );
    const readReviews = surface.ok && isCapabilityEnabled(surface.value, 'version:reviewRead');
    const readProposals = surface.ok && isCapabilityEnabled(surface.value, 'version:proposal');

    const [rollout, head, commits, refs, reviews, proposals] = await Promise.all([
      readValue('VERSION_UI_STATUS_FAILED', () => workbook.version.getStatus()),
      readVersionResult('VERSION_UI_HEAD_FAILED', () => workbook.version.getHead()),
      readVersionResult('VERSION_UI_COMMITS_FAILED', () =>
        workbook.version.listCommits({ pageSize: COMMIT_PAGE_SIZE, includeDiagnostics: true }),
      ),
      readVersionResult('VERSION_UI_REFS_FAILED', () =>
        workbook.version.listRefs({ includeDiagnostics: true }),
      ),
      readReviews
        ? readVersionResult('VERSION_UI_REVIEWS_FAILED', () =>
            workbook.version.listReviews({ limit: REVIEW_PAGE_SIZE }),
          )
        : Promise.resolve(emptyPagedRead<WorkbookVersionReviewRecordSummary>(REVIEW_PAGE_SIZE)),
      readProposals
        ? readVersionResult('VERSION_UI_PROPOSALS_FAILED', () =>
            workbook.version.listProposals({ limit: PROPOSAL_PAGE_SIZE }),
          )
        : Promise.resolve(emptyPagedRead<AgentProposalSummary>(PROPOSAL_PAGE_SIZE)),
    ]);

    if (!surface.ok) diagnostics.push(surface.diagnostic);
    if (!rollout.ok) diagnostics.push(rollout.diagnostic);
    if (!head.ok) diagnostics.push(head.diagnostic);
    if (!commits.ok) diagnostics.push(commits.diagnostic);
    if (!refs.ok) diagnostics.push(refs.diagnostic);
    if (!reviews.ok) diagnostics.push(reviews.diagnostic);
    if (!proposals.ok) diagnostics.push(proposals.diagnostic);

    const data: VersionHistoryData = {
      ...(surface.ok ? { surface: surface.value } : {}),
      ...(rollout.ok ? { rollout: rollout.value } : {}),
      ...(head.ok ? { head: head.value } : {}),
      commits: commits.ok ? commits.value.items : [],
      refs: refs.ok ? refs.value.items : [],
      reviews: reviews.ok ? reviews.value.items : [],
      proposals: proposals.ok ? proposals.value.items : [],
      ...(!reviews.ok ? { reviewDiagnostic: reviews.diagnostic } : {}),
      ...(!proposals.ok ? { proposalDiagnostic: proposals.diagnostic } : {}),
      diagnostics,
    };

    if (
      !surface.ok &&
      !rollout.ok &&
      !head.ok &&
      !commits.ok &&
      !refs.ok &&
      !reviews.ok &&
      !proposals.ok
    ) {
      setLoadState({ status: 'error', diagnostics });
      return;
    }
    setLoadState({ status: 'ready', data });
  }, [workbook]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
  }, []);

  useVersionPanelFocusTrap(panelRef);

  const data =
    loadState.status === 'ready'
      ? loadState.data
      : loadState.status === 'loading'
        ? loadState.previous
        : undefined;
  const diagnostics =
    loadState.status === 'error' ? loadState.diagnostics : (data?.diagnostics ?? []);
  const actionBusy = actionState.status === 'running';
  const loading = loadState.status === 'loading';
  const selectedOrHeadCommitId = data
    ? resolveSelectedOrHeadCommitId(data, selectedCommitId)
    : undefined;
  const commitAvailability = getCommitAvailability(data, actionBusy, loading, commitMessage);
  const branchAvailability = getBranchAvailability(
    data,
    actionBusy,
    loading,
    branchName,
    selectedOrHeadCommitId,
  );
  const checkoutAvailability = getCheckoutAvailability(data, actionBusy, loading);
  const diffAvailability = getDiffAvailability(data, actionBusy, loading);
  const rollbackAvailability = getRollbackAvailability(
    data,
    actionBusy,
    loading,
    rollbackReason,
    selectedOrHeadCommitId,
  );
  const canCommit = commitAvailability.enabled;
  const canCreateBranch = branchAvailability.enabled;
  const canCheckout = checkoutAvailability.enabled;
  const canDiff = diffAvailability.enabled;
  const canStageRollback = rollbackAvailability.enabled;

  const handleCommit = useCallback(async () => {
    if (!data || !canCommit) return;

    const message = commitMessage.trim();
    const expectedHead =
      data.head?.id && data.head.refRevision
        ? {
            commitId: data.head.id,
            revision: data.head.refRevision,
          }
        : undefined;
    const options: NonNullable<Parameters<WorkbookVersion['commit']>[0]> = expectedHead
      ? { message, expectedHead }
      : { message };

    setActionState({ status: 'running', label: 'Committing changes' });
    const result = await readVersionResult('VERSION_UI_COMMIT_FAILED', () =>
      workbook.version.commit(options),
    );
    if (!result.ok) {
      setActionState({ status: 'error', diagnostic: result.diagnostic });
      return;
    }

    setCommitMessage('');
    setSelectedCommitId(result.value.id);
    setActionState({ status: 'success', message: 'Committed changes' });
    await load();
  }, [canCommit, commitMessage, data, load, workbook]);

  const handleCreateBranch = useCallback(async () => {
    if (!data || !canCreateBranch || !selectedOrHeadCommitId) return;

    const normalizedBranch = normalizeVersionBranchNameInput(branchName);
    if (!normalizedBranch.ok) return;

    const name = normalizedBranch.branch.refName as Parameters<
      WorkbookVersion['createBranch']
    >[0]['name'];
    setActionState({ status: 'running', label: 'Creating branch' });
    const result = await readVersionResult('VERSION_UI_CREATE_BRANCH_FAILED', () =>
      workbook.version.createBranch({
        name,
        targetCommitId: selectedOrHeadCommitId,
        expectedAbsent: true,
      }),
    );
    if (!result.ok) {
      setActionState({ status: 'error', diagnostic: result.diagnostic });
      return;
    }

    setBranchName('');
    setSelectedCommitId(result.value.commitId);
    setActionState({
      status: 'success',
      message: `Created ${displayBranchName(result.value.name)}`,
    });
    await load();
  }, [branchName, canCreateBranch, data, load, selectedOrHeadCommitId, workbook]);

  const handleStageRollback = useCallback(async () => {
    if (!data || !canStageRollback || !selectedOrHeadCommitId) return;

    const targetRef = data.surface?.current.branchName as
      | VersionRevertInput['targetRef']
      | undefined;
    const expectedTargetHead =
      data.head?.id && data.head.refRevision
        ? {
            commitId: data.head.id,
            revision: data.head.refRevision,
          }
        : undefined;
    const input: VersionRevertInput = {
      target: { kind: 'commit', commitId: selectedOrHeadCommitId },
      ...(targetRef ? { targetRef } : {}),
      ...(expectedTargetHead ? { expectedTargetHead } : {}),
      reason: rollbackReason.trim(),
    };

    setActionState({ status: 'running', label: 'Staging rollback' });
    const result = await readVersionResult('VERSION_UI_REVERT_FAILED', () =>
      workbook.version.revert(input, { dryRun: true, includeDiagnostics: true }),
    );
    if (!result.ok) {
      setActionState({ status: 'error', diagnostic: result.diagnostic });
      return;
    }

    if (result.value.status === 'rejected') {
      setActionState({
        status: 'error',
        diagnostic: diagnosticFromRevertResult('VERSION_UI_REVERT_REJECTED', result.value),
      });
      return;
    }

    setRollbackReason('');
    setActionState({
      status: 'success',
      message: rollbackActionMessage(result.value, selectedOrHeadCommitId),
    });
  }, [canStageRollback, data, rollbackReason, selectedOrHeadCommitId, workbook]);

  const handleCheckoutRef = useCallback(
    async (ref: VersionRef) => {
      if (!canCheckout) return;

      setActionState({ status: 'running', label: 'Checking out branch' });
      const result = await readVersionResult('VERSION_UI_CHECKOUT_FAILED', () =>
        workbook.version.checkout(
          {
            kind: 'ref',
            name: ref.name,
          },
          { includeDiagnostics: true },
        ),
      );
      if (!result.ok) {
        setActionState({ status: 'error', diagnostic: result.diagnostic });
        return;
      }

      setSelectedCommitId(result.value.plan.commitId);
      setActionState({ status: 'success', message: `Checked out ${displayBranchName(ref.name)}` });
      await load();
    },
    [canCheckout, load, workbook],
  );

  const handleDiffCommit = useCallback(
    async (commit: WorkbookCommitSummary) => {
      const parentId = commit.parents[0];
      if (!canDiff || !parentId) return;

      setActionState({ status: 'running', label: 'Loading parent diff' });
      const result = await readVersionResult('VERSION_UI_DIFF_FAILED', () =>
        workbook.version.diff(parentId, commit.id, {
          pageSize: 50,
          includeDiagnostics: true,
        }),
      );
      if (!result.ok) {
        setActionState({ status: 'error', diagnostic: result.diagnostic });
        return;
      }

      setDiffPreview({ base: parentId, target: commit.id, page: result.value });
      setActionState({ status: 'success', message: 'Loaded parent diff' });
    },
    [canDiff, workbook],
  );

  const handleReviewProposalDiff = useCallback(
    async (target: ReviewProposalDiffTarget) => {
      if (!canDiff) return;

      const label = target.recordKind === 'review' ? 'review' : 'proposal';
      setActionState({ status: 'running', label: `Loading ${label} diff` });
      const result = await readVersionResult('VERSION_UI_DIFF_FAILED', () =>
        workbook.version.diff(target.baseCommitId, target.targetCommitId, {
          pageSize: 50,
          includeDiagnostics: true,
        }),
      );
      if (!result.ok) {
        setActionState({ status: 'error', diagnostic: result.diagnostic });
        return;
      }

      setDiffPreview({
        base: target.baseCommitId,
        target: target.targetCommitId,
        page: result.value,
      });
      setActionState({ status: 'success', message: `Loaded ${label} diff` });
    },
    [canDiff, workbook],
  );

  return (
    <aside
      ref={panelRef}
      data-testid="panel-version-history"
      role="complementary"
      aria-label="Version control"
      className="flex flex-col w-[320px] max-w-[calc(100vw-24px)] h-full bg-ss-surface border-l border-ss-border shadow-ss-md overflow-hidden"
    >
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
            onClick={load}
            data-testid="panel-version-history-refresh"
            className="w-7 h-7 flex items-center justify-center rounded-full text-ss-text-secondary hover:bg-ss-surface-hover cursor-pointer transition-colors disabled:opacity-50"
            aria-label="Refresh version history"
            title="Refresh"
            disabled={loadState.status === 'loading'}
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

      <div className="flex-1 overflow-y-auto" aria-busy={loading}>
        {loadState.status === 'loading' ? (
          <div
            className={data ? 'sr-only' : 'px-4 py-5 text-body-sm text-ss-text-secondary'}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid={data ? 'version-history-loading-status' : 'version-history-loading'}
          >
            {data ? 'Refreshing version history' : 'Loading version history'}
          </div>
        ) : null}

        {loadState.status === 'error' ? (
          <DiagnosticsBlock diagnostics={diagnostics} emptyMessage="Version history unavailable" />
        ) : null}

        {data ? (
          <div className="flex flex-col gap-4 p-4">
            <VersionStatusSummary data={data} />
            <CapabilitySummary surface={data.surface} />
            <VersionActions
              commitMessage={commitMessage}
              branchName={branchName}
              rollbackReason={rollbackReason}
              targetCommitId={selectedOrHeadCommitId}
              actionState={actionState}
              commitEnabled={canCommit}
              branchEnabled={canCreateBranch}
              rollbackEnabled={canStageRollback}
              commitDisabledReason={commitAvailability.disabledReason}
              branchDisabledReason={branchAvailability.disabledReason}
              rollbackDisabledReason={rollbackAvailability.disabledReason}
              onCommitMessageChange={setCommitMessage}
              onBranchNameChange={setBranchName}
              onRollbackReasonChange={setRollbackReason}
              onCommit={handleCommit}
              onCreateBranch={handleCreateBranch}
              onStageRollback={handleStageRollback}
            />
            <RefList
              refs={data.refs}
              checkoutEnabled={canCheckout}
              checkoutDisabledReason={checkoutAvailability.disabledReason}
              onCheckoutRef={handleCheckoutRef}
            />
            <ReviewProposalSurface
              surface={data.surface}
              reviews={data.reviews}
              proposals={data.proposals}
              reviewDiagnostic={data.reviewDiagnostic}
              proposalDiagnostic={data.proposalDiagnostic}
              diffEnabled={canDiff}
              diffDisabledReason={diffAvailability.disabledReason}
              onOpenDiff={handleReviewProposalDiff}
            />
            <CommitList
              commits={data.commits}
              selectedCommitId={selectedCommitId}
              diffEnabled={canDiff}
              diffDisabledReason={diffAvailability.disabledReason}
              onSelectCommit={setSelectedCommitId}
              onDiffCommit={handleDiffCommit}
            />
            <VersionHistoryDiffPreview diffPreview={diffPreview} />
            {diagnostics.length > 0 ? <DiagnosticsBlock diagnostics={diagnostics} /> : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function VersionStatusSummary({ data }: { readonly data: VersionHistoryData }): React.JSX.Element {
  const headId = data.head?.id ?? data.surface?.current.headCommitId;
  const branchName = data.surface?.current.branchName ?? data.head?.refName;
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
        <span className="text-ss-text truncate">{branchName ?? 'Detached or unavailable'}</span>
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

function CapabilitySummary({
  surface,
}: {
  readonly surface?: VersionSurfaceStatus;
}): React.JSX.Element {
  const rows = useMemo(
    () =>
      CAPABILITY_ROWS.map((capability) => ({
        capability,
        state: surface?.capabilities[capability],
      })),
    [surface],
  );

  return (
    <section className="flex flex-wrap gap-1.5" aria-label="Version capabilities">
      {rows.map(({ capability, state }) => {
        const enabled = state?.enabled === true;
        const reason = state?.enabled === false ? state.reason : 'Unavailable';
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

function RefList({
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

  return (
    <section className="flex flex-col gap-2" aria-label="Branches">
      <div className="flex items-center gap-2 text-body-sm font-semibold text-ss-text">
        <GitBranch size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>Branches</span>
      </div>
      <DisabledReason
        id={checkoutReasonId}
        reason={!checkoutEnabled ? checkoutDisabledReason : undefined}
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
                    aria-describedby={
                      !checkoutEnabled && checkoutDisabledReason ? checkoutReasonId : undefined
                    }
                    title={!checkoutEnabled ? checkoutDisabledReason : undefined}
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

function CommitList({
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

function DiagnosticsBlock({
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

async function readValue<T>(
  code: string,
  read: () => Promise<T>,
): Promise<
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: VersionPanelDiagnostic }
> {
  try {
    return { ok: true, value: await read() };
  } catch {
    return {
      ok: false,
      diagnostic: {
        code,
        severity: 'warning',
        message: 'Version service call failed.',
      },
    };
  }
}

async function readVersionResult<T>(
  code: string,
  read: () => Promise<VersionResult<T>>,
): Promise<
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: VersionPanelDiagnostic }
> {
  try {
    const result = await read();
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, diagnostic: diagnosticFromError(code, result.error) };
  } catch {
    return {
      ok: false,
      diagnostic: {
        code,
        severity: 'warning',
        message: 'Version service call failed.',
      },
    };
  }
}

function emptyPagedRead<T>(limit: number): { readonly ok: true; readonly value: Paged<T> } {
  return { ok: true, value: { items: [], limit } };
}

function resolveSelectedOrHeadCommitId(
  data: VersionHistoryData,
  selectedCommitId: WorkbookCommitId | undefined,
): WorkbookCommitId | undefined {
  if (selectedCommitId) return selectedCommitId;
  if (data.head?.id) return data.head.id;
  return data.surface?.current.headCommitId as WorkbookCommitId | undefined;
}

function rollbackActionMessage(
  result: VersionRevertResult,
  targetCommitId: WorkbookCommitId,
): string {
  const target = shortCommitId(targetCommitId);
  if (result.status === 'planned') return `Rollback staged for ${target}`;
  if (result.status === 'requires-review') return `Rollback for ${target} requires review`;
  if (result.status === 'applied') return `Rollback applied for ${target}`;
  return `Rollback rejected for ${target}`;
}

function diagnosticFromRevertResult(
  code: string,
  result: VersionRevertResult,
): VersionPanelDiagnostic {
  const diagnostic = result.diagnostics.find((entry) => entry.safeMessage.trim().length > 0);
  if (!diagnostic) {
    return { code, severity: 'warning', message: 'Rollback preflight was rejected.' };
  }
  return {
    code: diagnostic.issueCode,
    severity: diagnostic.severity === 'fatal' ? 'error' : diagnostic.severity,
    message: diagnostic.safeMessage,
  };
}

function diagnosticFromError(code: string, error: VersionError): VersionPanelDiagnostic {
  if (error.code === 'target_unavailable') {
    return {
      code: error.diagnostics[0]?.code ?? code,
      severity: error.diagnostics[0]?.severity ?? 'warning',
      message: error.diagnostics[0]?.message ?? error.target,
    };
  }
  if (
    error.code === 'version_capability_unavailable' ||
    error.code === 'invalid_state' ||
    error.code === 'not_found' ||
    error.code === 'invalid_branch_name' ||
    error.code === 'redaction_blocked'
  ) {
    return { code, severity: 'warning', message: error.reason };
  }
  if (error.code === 'stale_head') {
    return {
      code,
      severity: 'warning',
      message: `Version head changed before the request completed. Expected ${shortCommitId(
        error.expectedHeadId,
      )}, now ${shortCommitId(error.actualHeadId)}. Refresh version history before retrying.`,
    };
  }
  if (error.code === 'stale_revision') {
    return { code, severity: 'warning', message: 'Version revision is stale.' };
  }
  return { code, severity: 'warning', message: 'Version request failed.' };
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
