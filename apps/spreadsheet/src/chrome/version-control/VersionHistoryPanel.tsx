import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitBranch, GitCommit, GitCompare, History, RefreshCw, X } from 'lucide-react';
import type {
  AgentProposalSummary,
  Paged,
  VersionAnnotationText,
  VersionCapability,
  VersionDiagnostic,
  VersionError,
  VersionHead,
  VersionRef,
  VersionResult,
  VersionSemanticDiffPage,
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
  isCapabilityEnabled,
  safeDomId,
} from './version-action-availability';
import { ActionStatus } from './VersionActionStatus';
import { ReviewProposalSurface } from './ReviewProposalSurface';

const COMMIT_PAGE_SIZE = 20;
const REVIEW_PAGE_SIZE = 5;
const PROPOSAL_PAGE_SIZE = 5;
const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';

const CAPABILITY_ROWS: readonly VersionCapability[] = [
  'version:read',
  'version:diff',
  'version:commit',
  'version:branch',
  'version:checkout',
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

type VersionPanelDiagnostic = {
  readonly code: string;
  readonly severity: VersionDiagnostic['severity'];
  readonly message: string;
};

type VersionActionState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly label: string }
  | { readonly status: 'success'; readonly message: string }
  | { readonly status: 'error'; readonly diagnostic: VersionPanelDiagnostic };

type VersionDiffPreview = {
  readonly base: WorkbookCommitId;
  readonly target: WorkbookCommitId;
  readonly page: VersionSemanticDiffPage;
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
  const [selectedCommitId, setSelectedCommitId] = useState<WorkbookCommitId | undefined>();
  const [actionState, setActionState] = useState<VersionActionState>({ status: 'idle' });
  const [diffPreview, setDiffPreview] = useState<VersionDiffPreview | undefined>();

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
  const canCommit = commitAvailability.enabled;
  const canCreateBranch = branchAvailability.enabled;
  const canCheckout = checkoutAvailability.enabled;
  const canDiff = diffAvailability.enabled;

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

    const name = branchName.trim() as Parameters<WorkbookVersion['createBranch']>[0]['name'];
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

  return (
    <aside
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

      <div className="flex-1 overflow-y-auto">
        {loadState.status === 'loading' && !data ? (
          <div
            className="px-4 py-5 text-body-sm text-ss-text-secondary"
            data-testid="version-history-loading"
          >
            Loading version history
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
              targetCommitId={selectedOrHeadCommitId}
              actionState={actionState}
              commitEnabled={canCommit}
              branchEnabled={canCreateBranch}
              commitDisabledReason={commitAvailability.disabledReason}
              branchDisabledReason={branchAvailability.disabledReason}
              onCommitMessageChange={setCommitMessage}
              onBranchNameChange={setBranchName}
              onCommit={handleCommit}
              onCreateBranch={handleCreateBranch}
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
            />
            <CommitList
              commits={data.commits}
              selectedCommitId={selectedCommitId}
              diffEnabled={canDiff}
              diffDisabledReason={diffAvailability.disabledReason}
              onSelectCommit={setSelectedCommitId}
              onDiffCommit={handleDiffCommit}
            />
            <DiffPreview diffPreview={diffPreview} />
            {diagnostics.length > 0 ? <DiagnosticsBlock diagnostics={diagnostics} /> : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function VersionActions({
  commitMessage,
  branchName,
  targetCommitId,
  actionState,
  commitEnabled,
  branchEnabled,
  commitDisabledReason,
  branchDisabledReason,
  onCommitMessageChange,
  onBranchNameChange,
  onCommit,
  onCreateBranch,
}: {
  readonly commitMessage: string;
  readonly branchName: string;
  readonly targetCommitId?: WorkbookCommitId;
  readonly actionState: VersionActionState;
  readonly commitEnabled: boolean;
  readonly branchEnabled: boolean;
  readonly commitDisabledReason?: string;
  readonly branchDisabledReason?: string;
  readonly onCommitMessageChange: (value: string) => void;
  readonly onBranchNameChange: (value: string) => void;
  readonly onCommit: () => void;
  readonly onCreateBranch: () => void;
}): React.JSX.Element {
  const commitReasonId = 'version-commit-disabled-reason';
  const branchReasonId = 'version-branch-disabled-reason';

  return (
    <section className="flex flex-col gap-3" aria-label="Version actions">
      <div className="flex flex-col gap-2">
        <label htmlFor="version-commit-message" className="text-body-sm font-medium text-ss-text">
          Commit message
        </label>
        <textarea
          id="version-commit-message"
          value={commitMessage}
          onChange={(event) => onCommitMessageChange(event.currentTarget.value)}
          rows={2}
          className="w-full resize-none rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-body-sm text-ss-text outline-none focus:border-ss-primary"
        />
        <button
          type="button"
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
          type="text"
          value={branchName}
          onChange={(event) => onBranchNameChange(event.currentTarget.value)}
          className="w-full rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-body-sm text-ss-text outline-none focus:border-ss-primary"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 font-mono text-[11px] text-ss-text-secondary truncate">
            Target {targetCommitId ? shortCommitId(targetCommitId) : 'unavailable'}
          </span>
          <button
            type="button"
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

      <ActionStatus actionState={actionState} />
    </section>
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
        return (
          <span
            key={capability}
            className={`px-2 py-1 rounded-sm text-[11px] leading-none border ${
              enabled
                ? 'border-ss-success/40 text-ss-success bg-ss-success/10'
                : 'border-ss-border text-ss-text-secondary bg-ss-surface-secondary'
            }`}
            title={
              enabled
                ? `${CAPABILITY_LABELS[capability]} enabled`
                : (state?.reason ?? 'Unavailable')
            }
          >
            {CAPABILITY_LABELS[capability]}
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
                    <input
                      type="radio"
                      name="version-history-branch-target"
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

function DiffPreview({
  diffPreview,
}: {
  readonly diffPreview?: VersionDiffPreview;
}): React.JSX.Element | null {
  if (!diffPreview) return null;
  const count = diffPreview.page.items.length;

  return (
    <section
      className="flex flex-col gap-2 border border-ss-border rounded-sm p-2 bg-ss-surface-secondary"
      aria-label="Parent diff"
      data-testid="version-history-parent-diff"
    >
      <div className="flex items-center gap-2 text-body-sm font-semibold text-ss-text">
        <GitCompare size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>Parent Diff</span>
      </div>
      <div className="grid grid-cols-[52px_1fr] gap-x-2 gap-y-1 text-[11px]">
        <span className="text-ss-text-secondary">Base</span>
        <span className="font-mono text-ss-text truncate">{shortCommitId(diffPreview.base)}</span>
        <span className="text-ss-text-secondary">Target</span>
        <span className="font-mono text-ss-text truncate">{shortCommitId(diffPreview.target)}</span>
        <span className="text-ss-text-secondary">Changes</span>
        <span className="text-ss-text">{count}</span>
      </div>
      {count === 0 ? (
        <div className="text-body-sm text-ss-text-secondary">No semantic changes</div>
      ) : (
        <ol className="flex flex-col gap-1 m-0 p-0 list-none">
          {diffPreview.page.items.map((entry, index) => (
            <li key={index} className="text-[11px] text-ss-text-secondary truncate">
              {diffEntryLabel(entry)}
            </li>
          ))}
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
  return {
    ok: true,
    value: { items: [], limit },
  };
}

function resolveSelectedOrHeadCommitId(
  data: VersionHistoryData,
  selectedCommitId: WorkbookCommitId | undefined,
): WorkbookCommitId | undefined {
  if (selectedCommitId) return selectedCommitId;
  if (data.head?.id) return data.head.id;
  return data.surface?.current.headCommitId as WorkbookCommitId | undefined;
}

function diagnosticFromError(code: string, error: VersionError): VersionPanelDiagnostic {
  if (error.code === 'target_unavailable') {
    return {
      code: error.diagnostics[0]?.code ?? code,
      severity: error.diagnostics[0]?.severity ?? 'warning',
      message: error.diagnostics[0]?.message ?? error.target,
    };
  }
  if (error.code === 'version_capability_unavailable') {
    return { code, severity: 'warning', message: error.reason };
  }
  if (error.code === 'invalid_state') {
    return { code, severity: 'warning', message: error.reason };
  }
  if (error.code === 'not_found') {
    return { code, severity: 'warning', message: error.reason };
  }
  if (error.code === 'invalid_branch_name') {
    return { code, severity: 'warning', message: error.reason };
  }
  if (error.code === 'stale_head') {
    return {
      code,
      severity: 'warning',
      message: `Expected ${shortCommitId(error.expectedHeadId)}`,
    };
  }
  if (error.code === 'stale_revision') {
    return { code, severity: 'warning', message: 'Version revision is stale.' };
  }
  if (error.code === 'redaction_blocked') {
    return { code, severity: 'warning', message: error.reason };
  }
  return { code, severity: 'warning', message: 'Version request failed.' };
}

function annotationText(value: VersionAnnotationText | undefined): string | undefined {
  if (!value) return undefined;
  return value.kind === 'text' ? value.value : 'Redacted';
}

function shortCommitId(id: string): string {
  return id.startsWith('commit:sha256:')
    ? id.slice('commit:sha256:'.length, 'commit:sha256:'.length + 12)
    : id;
}

function displayBranchName(name: string): string {
  return name.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? name.slice(VERSION_BRANCH_REF_PREFIX.length)
    : name;
}

function diffEntryLabel(entry: VersionSemanticDiffPage['items'][number]): string {
  if (entry.structural.kind !== 'metadata') return 'Redacted change';
  const path = entry.structural.propertyPath.join('.');
  return path ? `${entry.structural.domain} ${path}` : entry.structural.domain;
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
