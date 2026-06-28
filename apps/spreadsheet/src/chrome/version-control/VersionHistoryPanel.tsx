import { useEffect, useRef } from 'react';

import { useWorkbook } from '../../internal-api';
import { VersionActions } from './VersionActionStatus';
import { VersionHistoryDiffPreview } from './VersionHistoryDiffPreview';
import { ReviewProposalSurface } from './ReviewProposalSurface';
import { reviewProposalAccessDiagnosticsFromSummaries } from './review-proposal-access-diagnostics';
import { useVersionPanelFocusTrap } from './useVersionPanelFocusTrap';
import { useVersionHistoryPanelActions } from './version-history-panel-actions';
import { useVersionHistoryData, type VersionHistoryWorkbook } from './version-history-panel-data';
import {
  CommitList,
  CurrentBranchMenu,
  DiagnosticsBlock,
  VersionHistoryPanelHeader,
  VersionStatusAlerts,
  WorkingTreeDiffSection,
} from './VersionHistoryPanelSections';
import { MergeReviewSection } from './VersionMergeReviewSection';

export interface VersionHistoryPanelProps {
  readonly onClose: () => void;
}

export interface VersionHistoryPanelContentProps {
  readonly workbook: VersionHistoryWorkbook;
  readonly onClose: () => void;
}

export type { VersionHistoryWorkbook } from './version-history-panel-data';

export function VersionHistoryPanel({ onClose }: VersionHistoryPanelProps): React.JSX.Element {
  const workbook = useWorkbook();
  return <VersionHistoryPanelContent workbook={workbook} onClose={onClose} />;
}

export function VersionHistoryPanelContent({
  workbook,
  onClose,
}: VersionHistoryPanelContentProps): React.JSX.Element {
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const { loadState, load, data, diagnostics, loading } = useVersionHistoryData(workbook);
  const actions = useVersionHistoryPanelActions({ workbook, data, loading, load });
  const reviewProposalAccessDiagnostics = data
    ? reviewProposalAccessDiagnosticsFromSummaries(data)
    : undefined;
  const showReviewProposalSurface = data
    ? data.reviews.length > 0 || data.proposals.length > 0
    : false;

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
  }, []);

  useVersionPanelFocusTrap(panelRef);

  return (
    <aside
      ref={panelRef}
      data-testid="panel-version-history"
      role="complementary"
      aria-label="Version control"
      className="flex flex-col w-[440px] max-w-[calc(100vw-24px)] h-full bg-ss-surface border-l border-ss-border shadow-ss-md overflow-hidden"
    >
      <VersionHistoryPanelHeader
        branchControl={
          data ? (
            <CurrentBranchMenu
              data={data}
              branchName={actions.branchName}
              sourceCommitId={actions.currentOrHeadCommitId}
              branchEnabled={actions.canCreateBranch}
              checkoutEnabled={actions.canCheckout}
              branchDisabledReason={actions.branchDisabledReason}
              checkoutDisabledReason={actions.checkoutDisabledReason}
              mergePreviewEnabled={actions.canPreviewMerge}
              mergePreviewDisabledReason={actions.mergePreviewDisabledReason}
              onBranchNameChange={actions.setBranchName}
              onCreateBranch={actions.handleCreateBranch}
              onCheckoutRef={actions.handleCheckoutRef}
              onPreviewMerge={actions.handlePreviewMerge}
            />
          ) : undefined
        }
        closeButtonRef={closeButtonRef}
        onClose={onClose}
        onRefresh={load}
        refreshDisabled={loadState.status === 'loading' && !data}
        refreshInProgress={loadState.status === 'loading'}
      />

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
          <div className="flex flex-col gap-3 p-3">
            <VersionStatusAlerts data={data} />
            <VersionActions
              commitMessage={actions.commitMessage}
              actionState={actions.actionState}
              commitEnabled={actions.canCommit}
              commitDisabledReason={actions.commitDisabledReason}
              onCommitMessageChange={actions.setCommitMessage}
              onCommit={actions.handleCommit}
            />
            <WorkingTreeDiffSection diff={data.workingTreeDiff} />
            <VersionHistoryDiffPreview
              diffPreview={actions.diffPreview}
              diffEnabled={actions.canDiff}
              diffDisabledReason={actions.diffDisabledReason}
              onLoadMoreGroups={actions.handleLoadMoreDiffGroups}
              onSelectGroup={actions.handleSelectDiffGroup}
              onLoadMoreDetail={actions.handleLoadMoreDiffDetail}
              onFiltersChange={actions.handleDiffFiltersChange}
            />
            {actions.mergeReview ? (
              <MergeReviewSection
                state={actions.mergeReview}
                applyEnabled={actions.canApplyMerge}
                applyDisabledReason={actions.mergeApplyDisabledReason}
                onChooseResolution={actions.handleChooseMergeResolution}
                onApply={actions.handleApplyMerge}
              />
            ) : null}
            <CommitList
              activeParentDiffCommitId={actions.activeParentDiffCommitId}
              branchName={actions.branchName}
              commits={data.commits}
              checkoutEnabled={actions.canCheckout}
              checkoutDisabledReason={actions.checkoutDisabledReason}
              diffEnabled={actions.canDiff}
              diffDisabledReason={actions.diffDisabledReason}
              getBranchAvailabilityForCommit={actions.getBranchAvailabilityForCommit}
              onBranchNameChange={actions.setBranchName}
              onCheckoutCommit={actions.handleCheckoutCommit}
              onCreateBranchFromCommit={actions.handleCreateBranch}
              onDiffCommit={actions.handleDiffCommit}
            />
            {showReviewProposalSurface ? (
              <ReviewProposalSurface
                surface={data.surface}
                reviews={data.reviews}
                proposals={data.proposals}
                reviewDiagnostic={data.reviewDiagnostic}
                proposalDiagnostic={data.proposalDiagnostic}
                diffEnabled={actions.canDiff}
                diffDisabledReason={actions.diffDisabledReason}
                onOpenDiff={actions.handleReviewProposalDiff}
                accessDiagnostics={reviewProposalAccessDiagnostics}
              />
            ) : null}
            {diagnostics.length > 0 ? <DiagnosticsBlock diagnostics={diagnostics} /> : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
