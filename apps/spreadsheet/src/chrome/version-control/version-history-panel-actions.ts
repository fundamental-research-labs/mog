import { useCallback, useState } from 'react';
import type {
  VersionRef,
  VersionRevertInput,
  WorkbookCommitId,
  WorkbookCommitSummary,
  WorkbookVersion,
} from '@mog-sdk/contracts/api';

import {
  getBranchAvailability,
  getCheckoutAvailability,
  getCommitAvailability,
  getDiffAvailability,
  getRemotePromoteAvailability,
  getRollbackAvailability,
} from './version-action-availability';
import {
  diagnosticFromRemotePromotionResult,
  getRemotePromotionStatus,
  remotePromotionActionMessage,
  type VersionActionState,
} from './VersionActionStatus';
import type { VersionDiffPreview } from './VersionHistoryDiffPreview';
import type { ReviewProposalDiffTarget } from './ReviewProposalSurface';
import { displayBranchName, normalizeVersionBranchNameInput } from './version-branch-name';
import {
  diagnosticFromRevertResult,
  readVersionResult,
  resolveSelectedOrHeadCommitId,
  rollbackActionMessage,
  type VersionHistoryData,
  type VersionHistoryWorkbook,
} from './version-history-panel-data';

type UseVersionHistoryPanelActionsInput = {
  readonly workbook: VersionHistoryWorkbook;
  readonly data?: VersionHistoryData;
  readonly loading: boolean;
  readonly load: () => Promise<void>;
};

export function useVersionHistoryPanelActions({
  workbook,
  data,
  loading,
  load,
}: UseVersionHistoryPanelActionsInput) {
  const [commitMessage, setCommitMessage] = useState('');
  const [branchName, setBranchName] = useState('');
  const [rollbackReason, setRollbackReason] = useState('');
  const [selectedCommitId, setSelectedCommitId] = useState<WorkbookCommitId | undefined>();
  const [actionState, setActionState] = useState<VersionActionState>({ status: 'idle' });
  const [diffPreview, setDiffPreview] = useState<VersionDiffPreview | undefined>();

  const actionBusy = actionState.status === 'running';
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
  const remotePromoteAvailability = getRemotePromoteAvailability(data, actionBusy, loading);
  const remotePromotionStatus = getRemotePromotionStatus(data?.surface);
  const canCommit = commitAvailability.enabled;
  const canCreateBranch = branchAvailability.enabled;
  const canCheckout = checkoutAvailability.enabled;
  const canDiff = diffAvailability.enabled;
  const canStageRollback = rollbackAvailability.enabled;
  const canPromoteRemote = remotePromoteAvailability.enabled;

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
    setActionState({ status: 'running', label: 'Refreshing version history' });
    await load();
    setActionState({ status: 'success', message: 'Committed changes' });
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
    setActionState({ status: 'running', label: 'Refreshing version history' });
    await load();
    setActionState({
      status: 'success',
      message: `Created ${displayBranchName(result.value.name)}`,
    });
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

  const handlePromotePendingRemote = useCallback(async () => {
    if (!data || !canPromoteRemote) return;

    setActionState({ status: 'running', label: 'Promoting pending remote changes' });
    const result = await readVersionResult('VERSION_UI_REMOTE_PROMOTE_FAILED', () =>
      workbook.version.promotePendingRemote({ includeDiagnostics: true }),
    );
    if (!result.ok) {
      setActionState({ status: 'error', diagnostic: result.diagnostic });
      return;
    }

    if (result.value.status === 'failed') {
      setActionState({
        status: 'error',
        diagnostic: diagnosticFromRemotePromotionResult(
          'VERSION_UI_REMOTE_PROMOTE_REJECTED',
          result.value,
        ),
      });
      return;
    }

    setActionState({ status: 'running', label: 'Refreshing version history' });
    await load();
    setActionState({
      status: 'success',
      message: remotePromotionActionMessage(result.value),
    });
  }, [canPromoteRemote, data, load, workbook]);

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
      setActionState({ status: 'running', label: 'Refreshing version history' });
      await load();
      setActionState({ status: 'success', message: `Checked out ${displayBranchName(ref.name)}` });
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

  return {
    actionState,
    branchDisabledReason: branchAvailability.disabledReason,
    branchName,
    canCheckout,
    canCommit,
    canCreateBranch,
    canDiff,
    canPromoteRemote,
    canStageRollback,
    checkoutDisabledReason: checkoutAvailability.disabledReason,
    commitDisabledReason: commitAvailability.disabledReason,
    commitMessage,
    diffDisabledReason: diffAvailability.disabledReason,
    diffPreview,
    handleCheckoutRef,
    handleCommit,
    handleCreateBranch,
    handleDiffCommit,
    handlePromotePendingRemote,
    handleReviewProposalDiff,
    handleStageRollback,
    remotePromoteDisabledReason: remotePromoteAvailability.disabledReason,
    remotePromotionStatus,
    rollbackDisabledReason: rollbackAvailability.disabledReason,
    rollbackReason,
    selectedCommitId,
    selectedOrHeadCommitId,
    setBranchName,
    setCommitMessage,
    setRollbackReason,
    setSelectedCommitId,
  };
}
