import { useEffect, useRef } from 'react';

import { useWorkbook } from '../../internal-api';
import { VersionActions } from './VersionActionStatus';
import { VersionHistoryDiffPreview } from './VersionHistoryDiffPreview';
import { VersionMergeControls } from './merge';
import { ReviewProposalSurface } from './ReviewProposalSurface';
import { reviewProposalAccessDiagnosticsFromSummaries } from './review-proposal-access-diagnostics';
import { useVersionPanelFocusTrap } from './useVersionPanelFocusTrap';
import { useVersionHistoryPanelActions } from './version-history-panel-actions';
import { useVersionHistoryData, type VersionHistoryWorkbook } from './version-history-panel-data';
import {
  CapabilitySummary,
  CommitList,
  DiagnosticsBlock,
  RefList,
  VersionHistoryPanelHeader,
  VersionStatusSummary,
} from './VersionHistoryPanelSections';

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
      className="flex flex-col w-[320px] max-w-[calc(100vw-24px)] h-full bg-ss-surface border-l border-ss-border shadow-ss-md overflow-hidden"
    >
      <VersionHistoryPanelHeader
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
          <div className="flex flex-col gap-4 p-4">
            <VersionStatusSummary data={data} />
            <CapabilitySummary surface={data.surface} />
            <VersionActions
              commitMessage={actions.commitMessage}
              branchName={actions.branchName}
              rollbackReason={actions.rollbackReason}
              targetCommitId={actions.selectedOrHeadCommitId}
              actionState={actions.actionState}
              commitEnabled={actions.canCommit}
              branchEnabled={actions.canCreateBranch}
              rollbackEnabled={actions.canStageRollback}
              remotePromoteEnabled={actions.canPromoteRemote}
              commitDisabledReason={actions.commitDisabledReason}
              branchDisabledReason={actions.branchDisabledReason}
              rollbackDisabledReason={actions.rollbackDisabledReason}
              remotePromoteDisabledReason={actions.remotePromoteDisabledReason}
              remotePromotionStatus={actions.remotePromotionStatus}
              onCommitMessageChange={actions.setCommitMessage}
              onBranchNameChange={actions.setBranchName}
              onRollbackReasonChange={actions.setRollbackReason}
              onCommit={actions.handleCommit}
              onCreateBranch={actions.handleCreateBranch}
              onStageRollback={actions.handleStageRollback}
              onPromotePendingRemote={actions.handlePromotePendingRemote}
            />
            <VersionMergeControls
              sourceRefs={actions.mergeSources}
              selectedSourceRefName={actions.mergeSourceRefName}
              currentHeadId={actions.currentMergeTarget?.commitId}
              currentRefName={actions.currentMergeTarget?.refName}
              previewState={actions.mergePreviewState}
              resolutionSelections={actions.mergeResolutionSelections}
              previewEnabled={actions.canPreviewMerge}
              applyEnabled={actions.canApplyMerge}
              previewDisabledReason={actions.mergePreviewDisabledReason}
              applyDisabledReason={actions.mergeApplyDisabledReason}
              onSourceRefNameChange={actions.setMergeSourceRefName}
              onPreviewMerge={actions.handlePreviewMerge}
              onApplyMerge={actions.handleApplyMerge}
              onResolutionChange={actions.handleMergeResolutionChange}
            />
            <RefList
              refs={data.refs}
              checkoutEnabled={actions.canCheckout}
              checkoutDisabledReason={actions.checkoutDisabledReason}
              onCheckoutRef={actions.handleCheckoutRef}
            />
            <ReviewProposalSurface
              surface={data.surface}
              reviews={data.reviews}
              proposals={data.proposals}
              reviewDiagnostic={data.reviewDiagnostic}
              proposalDiagnostic={data.proposalDiagnostic}
              diffEnabled={actions.canDiff}
              diffDisabledReason={actions.diffDisabledReason}
              onOpenDiff={actions.handleReviewProposalDiff}
              accessDiagnostics={reviewProposalAccessDiagnosticsFromSummaries(data)}
            />
            <CommitList
              commits={data.commits}
              selectedCommitId={actions.selectedCommitId}
              diffEnabled={actions.canDiff}
              diffDisabledReason={actions.diffDisabledReason}
              onSelectCommit={actions.setSelectedCommitId}
              onDiffCommit={actions.handleDiffCommit}
            />
            <VersionHistoryDiffPreview diffPreview={actions.diffPreview} />
            {diagnostics.length > 0 ? <DiagnosticsBlock diagnostics={diagnostics} /> : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
