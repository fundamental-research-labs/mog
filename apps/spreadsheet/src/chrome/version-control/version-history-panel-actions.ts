import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  VersionRef,
  WorkbookCommitId,
  WorkbookCommitSummary,
  WorkbookVersion,
} from '@mog-sdk/contracts/api';

import {
  getBranchAvailability,
  getCheckoutAvailability,
  getCommitAvailability,
  getDiffAvailability,
} from './availability/version-action-availability';
import { type VersionActionState } from './VersionActionStatus';
import type { VersionDiffPreview } from './VersionHistoryDiffPreview';
import type { ReviewProposalDiffTarget } from './ReviewProposalSurface';
import {
  VERSION_COMMIT_DIRTY_REFRESH_EVENTS,
  type VersionPanelActionKind,
  type VersionPanelActionRun,
} from './version-history-panel-action-run';
import {
  displayBranchName,
  normalizeVersionBranchNameInput,
  validateVersionBranchCreationName,
} from './version-branch-name';
import {
  commitDirtyRefreshFenceRequiresRefresh,
  commitDirtyRefreshFenceSnapshot,
  readVersionResult,
  resolvePreferredOrHeadCommitId,
  type CommitDirtyRefreshFence,
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
  const [actionState, setActionState] = useState<VersionActionState>({ status: 'idle' });
  const [diffPreview, setDiffPreview] = useState<VersionDiffPreview | undefined>();
  const actionSequenceRef = useRef(0);
  const activeActionRef = useRef<VersionPanelActionRun | undefined>(undefined);
  const latestDataRef = useRef<VersionHistoryData | undefined>(data);
  const commitDirtyRefreshFenceRef = useRef<CommitDirtyRefreshFence | undefined>(undefined);
  const [commitDirtyRefreshFence, setCommitDirtyRefreshFence] = useState<
    CommitDirtyRefreshFence | undefined
  >(undefined);
  latestDataRef.current = data;

  const actionBusy = actionState.status === 'running';
  const currentOrHeadCommitId = data ? resolvePreferredOrHeadCommitId(data, undefined) : undefined;
  const setCommitDirtyRefreshRequired = useCallback((fence: CommitDirtyRefreshFence) => {
    commitDirtyRefreshFenceRef.current = fence;
    setCommitDirtyRefreshFence(fence);
  }, []);
  const clearCommitDirtyRefreshRequired = useCallback(() => {
    commitDirtyRefreshFenceRef.current = undefined;
    setCommitDirtyRefreshFence(undefined);
  }, []);
  const markCommitDirtyRefreshRequired = useCallback(
    (fenceData: VersionHistoryData | undefined = latestDataRef.current) => {
      setCommitDirtyRefreshRequired({
        ...(fenceData ? { data: fenceData } : {}),
        ...commitDirtyRefreshFenceSnapshot(fenceData),
      });
    },
    [setCommitDirtyRefreshRequired],
  );
  const isCommitDirtyRefreshRequired = useCallback(() => {
    return commitDirtyRefreshFenceRequiresRefresh(
      commitDirtyRefreshFenceRef.current,
      latestDataRef.current,
    );
  }, []);
  const commitDirtyStatusRefreshing = commitDirtyRefreshFenceRequiresRefresh(
    commitDirtyRefreshFence,
    data,
  );
  const commitAvailability = getCommitAvailability(
    data,
    actionBusy,
    commitDirtyStatusRefreshing,
    commitMessage,
  );
  const branchAvailability = getBranchAvailability(
    data,
    actionBusy,
    loading,
    branchName,
    currentOrHeadCommitId,
  );
  const checkoutAvailability = getCheckoutAvailability(data, actionBusy, loading);
  const diffAvailability = getDiffAvailability(data, actionBusy, loading);
  const canCommit = commitAvailability.enabled;
  const canCreateBranch = branchAvailability.enabled;
  const canCheckout = checkoutAvailability.enabled;
  const canDiff = diffAvailability.enabled;

  useEffect(
    () => () => {
      activeActionRef.current = undefined;
    },
    [],
  );

  useEffect(() => {
    if (!workbook.on) return undefined;

    const markRefreshRequired = () => {
      markCommitDirtyRefreshRequired();
    };

    const unsubscriptions = VERSION_COMMIT_DIRTY_REFRESH_EVENTS.map((event) =>
      workbook.on?.(event, markRefreshRequired),
    );

    return () => {
      for (const unsubscribe of unsubscriptions) {
        unsubscribe?.();
      }
    };
  }, [markCommitDirtyRefreshRequired, workbook]);

  useEffect(() => {
    if (!commitDirtyRefreshFence) return;
    if (commitDirtyRefreshFenceRequiresRefresh(commitDirtyRefreshFence, data)) return;
    clearCommitDirtyRefreshRequired();
  }, [clearCommitDirtyRefreshRequired, commitDirtyRefreshFence, data]);

  const beginAction = useCallback((kind: VersionPanelActionKind) => {
    if (activeActionRef.current) return undefined;
    const action = { id: (actionSequenceRef.current += 1), kind };
    activeActionRef.current = action;
    return action;
  }, []);

  const isActionCurrent = useCallback((action: VersionPanelActionRun) => {
    const active = activeActionRef.current;
    return active?.id === action.id && active.kind === action.kind;
  }, []);

  const setRunningAction = useCallback(
    (action: VersionPanelActionRun, label: string) => {
      if (!isActionCurrent(action)) return false;
      setActionState({ status: 'running', label });
      return true;
    },
    [isActionCurrent],
  );

  const completeAction = useCallback(
    (action: VersionPanelActionRun, nextState: VersionActionState) => {
      if (!isActionCurrent(action)) return false;
      activeActionRef.current = undefined;
      setActionState(nextState);
      return true;
    },
    [isActionCurrent],
  );

  const refreshThenCompleteAction = useCallback(
    async (action: VersionPanelActionRun, nextState: VersionActionState) => {
      if (!setRunningAction(action, 'Refreshing version history')) return false;
      await load();
      if (!isActionCurrent(action)) return false;
      return completeAction(action, nextState);
    },
    [completeAction, isActionCurrent, load, setRunningAction],
  );

  const cancelAction = useCallback(
    (action: VersionPanelActionRun) => {
      if (!isActionCurrent(action)) return false;
      activeActionRef.current = undefined;
      setActionState({ status: 'idle' });
      return true;
    },
    [isActionCurrent],
  );

  const handleCommit = useCallback(async () => {
    if (!data || !canCommit || isCommitDirtyRefreshRequired()) return;
    const action = beginAction('commit');
    if (!action) return;
    const dirtyRefreshFenceData = data;

    const message = commitMessage.trim();
    if (!setRunningAction(action, 'Committing changes')) return;
    const result = await readVersionResult('VERSION_UI_COMMIT_FAILED', () =>
      workbook.version.commitCurrent({ message }),
    );
    if (!isActionCurrent(action)) return;
    if (!result.ok) {
      completeAction(action, { status: 'error', diagnostic: result.diagnostic });
      return;
    }

    markCommitDirtyRefreshRequired(dirtyRefreshFenceData);
    setCommitMessage('');
    await refreshThenCompleteAction(action, { status: 'success', message: 'Committed changes' });
  }, [
    beginAction,
    canCommit,
    commitMessage,
    completeAction,
    data,
    isCommitDirtyRefreshRequired,
    isActionCurrent,
    markCommitDirtyRefreshRequired,
    refreshThenCompleteAction,
    setRunningAction,
    workbook,
  ]);

  const handleCreateBranch = useCallback(
    async (targetCommitIdOverride?: WorkbookCommitId) => {
      const targetCommitId = targetCommitIdOverride ?? currentOrHeadCommitId;
      const availability =
        targetCommitId === currentOrHeadCommitId
          ? branchAvailability
          : getBranchAvailability(data, actionBusy, loading, branchName, targetCommitId);
      if (!data || !availability.enabled || !targetCommitId) return;
      const action = beginAction('branch');
      if (!action) return;

      const normalizedBranch = validateVersionBranchCreationName(branchName, data.refs);
      if (!normalizedBranch.ok) {
        cancelAction(action);
        return;
      }

      const name = normalizedBranch.branch.branchName as Parameters<
        WorkbookVersion['createBranchFromCurrent']
      >[0];
      if (!setRunningAction(action, 'Creating branch')) return;
      const result = await readVersionResult('VERSION_UI_CREATE_BRANCH_FAILED', () =>
        targetCommitIdOverride
          ? workbook.version.graph.createBranch({
              name: normalizedBranch.branch.refName as Parameters<
                WorkbookVersion['graph']['createBranch']
              >[0]['name'],
              targetCommitId,
              expectedAbsent: true,
            })
          : workbook.version.createBranchFromCurrent(name, { expectedAbsent: true }),
      );
      if (!isActionCurrent(action)) return;
      if (!result.ok) {
        completeAction(action, { status: 'error', diagnostic: result.diagnostic });
        return;
      }

      setBranchName('');
      await refreshThenCompleteAction(action, {
        status: 'success',
        message: `Created ${displayBranchName(result.value.name)}`,
      });
    },
    [
      beginAction,
      branchName,
      cancelAction,
      completeAction,
      actionBusy,
      branchAvailability,
      data,
      currentOrHeadCommitId,
      isActionCurrent,
      loading,
      refreshThenCompleteAction,
      setRunningAction,
      workbook,
    ],
  );

  const handleCheckoutRef = useCallback(
    async (ref: VersionRef) => {
      if (!canCheckout) return;
      const action = beginAction('checkout');
      if (!action) return;
      const dirtyRefreshFenceData = data;

      if (!setRunningAction(action, 'Checking out branch')) return;
      const normalizedBranch = normalizeVersionBranchNameInput(ref.name);
      const branchName = normalizedBranch.ok ? normalizedBranch.branch.branchName : ref.name;
      const result = await readVersionResult('VERSION_UI_CHECKOUT_FAILED', () =>
        workbook.version.checkoutBranch(branchName, { includeDiagnostics: true }),
      );
      if (!isActionCurrent(action)) return;
      if (!result.ok) {
        completeAction(action, { status: 'error', diagnostic: result.diagnostic });
        return;
      }

      markCommitDirtyRefreshRequired(dirtyRefreshFenceData);
      await refreshThenCompleteAction(action, { status: 'idle' });
    },
    [
      beginAction,
      canCheckout,
      completeAction,
      data,
      isActionCurrent,
      markCommitDirtyRefreshRequired,
      refreshThenCompleteAction,
      setRunningAction,
      workbook,
    ],
  );

  const handleCheckoutCommit = useCallback(
    async (commitId: WorkbookCommitId) => {
      if (!canCheckout) return;
      const action = beginAction('checkout');
      if (!action) return;
      const dirtyRefreshFenceData = data;

      if (!setRunningAction(action, 'Checking out commit')) return;
      const result = await readVersionResult('VERSION_UI_CHECKOUT_FAILED', () =>
        workbook.version.checkoutCommit(commitId, { includeDiagnostics: true }),
      );
      if (!isActionCurrent(action)) return;
      if (!result.ok) {
        completeAction(action, { status: 'error', diagnostic: result.diagnostic });
        return;
      }

      markCommitDirtyRefreshRequired(dirtyRefreshFenceData);
      await refreshThenCompleteAction(action, { status: 'idle' });
    },
    [
      beginAction,
      canCheckout,
      completeAction,
      data,
      isActionCurrent,
      markCommitDirtyRefreshRequired,
      refreshThenCompleteAction,
      setRunningAction,
      workbook,
    ],
  );

  const handleDiffCommit = useCallback(
    async (commit: WorkbookCommitSummary) => {
      const parentId = commit.parents[0];
      if (!canDiff || !parentId) return;

      setActionState({ status: 'running', label: 'Loading parent diff' });
      const result = await readVersionResult('VERSION_UI_DIFF_FAILED', () =>
        workbook.version.graph.diff(parentId, commit.id, {
          pageSize: 50,
          includeDiagnostics: true,
        }),
      );
      if (!result.ok) {
        setActionState({ status: 'error', diagnostic: result.diagnostic });
        return;
      }

      setDiffPreview({ base: parentId, target: commit.id, page: result.value });
      setActionState({ status: 'idle' });
    },
    [canDiff, workbook],
  );

  const getBranchAvailabilityForCommit = useCallback(
    (commitId: WorkbookCommitId) => {
      return getBranchAvailability(data, actionBusy, loading, branchName, commitId);
    },
    [actionBusy, branchName, data, loading],
  );

  const handleReviewProposalDiff = useCallback(
    async (target: ReviewProposalDiffTarget) => {
      if (!canDiff) return;

      const label = target.recordKind === 'review' ? 'review' : 'proposal';
      setActionState({ status: 'running', label: `Loading ${label} diff` });
      const result = await readVersionResult('VERSION_UI_DIFF_FAILED', () =>
        workbook.version.graph.diff(target.baseCommitId, target.targetCommitId, {
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
    checkoutDisabledReason: checkoutAvailability.disabledReason,
    commitDisabledReason: commitAvailability.disabledReason,
    commitMessage,
    diffDisabledReason: diffAvailability.disabledReason,
    diffPreview,
    getBranchAvailabilityForCommit,
    handleCheckoutCommit,
    handleCheckoutRef,
    handleCommit,
    handleCreateBranch,
    handleDiffCommit,
    handleReviewProposalDiff,
    currentOrHeadCommitId,
    setBranchName,
    setCommitMessage,
  };
}
