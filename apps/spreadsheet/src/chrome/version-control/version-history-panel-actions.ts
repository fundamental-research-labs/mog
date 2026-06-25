import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  VersionMergeInput,
  VersionRef,
  VersionRevertInput,
  WorkbookCommitId,
  WorkbookCommitSummary,
  WorkbookVersion,
} from '@mog-sdk/contracts/api';

import {
  getBranchAvailability,
  getCheckoutAvailability,
  getCapabilityAvailability,
  getCommitAvailability,
  getDiffAvailability,
  getRemotePromoteAvailability,
  getRollbackAvailability,
} from './availability/version-action-availability';
import {
  diagnosticFromRemotePromotionResult,
  getRemotePromotionStatus,
  remotePromotionActionMessage,
  type VersionActionState,
} from './VersionActionStatus';
import type { VersionDiffPreview } from './VersionHistoryDiffPreview';
import type { ReviewProposalDiffTarget } from './ReviewProposalSurface';
import {
  VERSION_COMMIT_DIRTY_REFRESH_EVENTS,
  type VersionPanelActionKind,
  type VersionPanelActionRun,
} from './version-history-panel-action-run';
import {
  applyMergeInputFromPreview,
  clearMergeReviewDraftForTarget,
  diagnosticFromMergeApplyResult,
  findLoadedMergeBase,
  mergeApplyActionDisabledReason,
  mergeApplyActionMessage,
  mergeApplyBlocked,
  mergeApplyBlockedMessage,
  mergeApplyConflictedMessage,
  mergeExpectedTargetHead,
  materializedActiveCheckoutMergeApplyOptions,
  mergePreviewActionDisabledReason,
  mergePreviewActionMessage,
  mergeSourceRefs,
  readMergeGraph,
  readMergeReviewDraftForTarget,
  resolveCurrentMergeTarget,
  sanitizeMergeReviewDraftSelections,
  writeMergeReviewDraft,
  type VersionMergePreviewState,
  type VersionMergeResolutionSelections,
  type VersionMergeTarget,
} from './merge';
import { displayBranchName, normalizeVersionBranchNameInput } from './version-branch-name';
import {
  firstDisabledAvailability,
  mergeSourcesMatch,
  mergeTargetsMatch,
} from './version-history-panel-action-utils';
import {
  commitDirtyRefreshFenceRequiresRefresh,
  commitDirtyRefreshFenceSnapshot,
  diagnosticFromRevertResult,
  readVersionResult,
  resolveSelectedOrHeadCommitId,
  rollbackActionMessage,
  type CommitDirtyRefreshFence,
  type VersionHistoryData,
  type VersionHistoryWorkbook,
} from './version-history-panel-data';
import { readCurrentMergeExpectedTargetHead } from './version-history-panel-merge-target-head';

export type { VersionMergePreviewState, VersionMergeResolutionSelections } from './merge';

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
  const [mergeSourceRefName, setMergeSourceRefNameState] = useState('');
  const [mergePreviewState, setMergePreviewState] = useState<VersionMergePreviewState>({
    kind: 'idle',
  });
  const [mergeResolutionSelections, setMergeResolutionSelections] =
    useState<VersionMergeResolutionSelections>({});
  const restoredMergeReviewDraftKeyRef = useRef<string | undefined>(undefined);
  const actionSequenceRef = useRef(0);
  const activeActionRef = useRef<VersionPanelActionRun | undefined>(undefined);
  const latestDataRef = useRef<VersionHistoryData | undefined>(data);
  const commitDirtyRefreshFenceRef = useRef<CommitDirtyRefreshFence | undefined>(undefined);
  const [commitDirtyRefreshFence, setCommitDirtyRefreshFence] = useState<
    CommitDirtyRefreshFence | undefined
  >(undefined);
  latestDataRef.current = data;

  const actionBusy = actionState.status === 'running';
  const selectedOrHeadCommitId = data
    ? resolveSelectedOrHeadCommitId(data, selectedCommitId)
    : undefined;
  const currentMergeTarget = useMemo(
    () => (data ? resolveCurrentMergeTarget(data) : undefined),
    [data],
  );
  const mergeSources = useMemo(() => (data ? mergeSourceRefs(data) : []), [data]);
  const selectedMergeSource = mergeSources.find((ref) => ref.name === mergeSourceRefName);
  const latestMergeContextRef = useRef<{
    readonly target?: VersionMergeTarget;
    readonly source?: VersionRef;
  }>({});
  latestMergeContextRef.current = {
    target: currentMergeTarget,
    source: selectedMergeSource,
  };
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
  const mergePreviewAvailability = getCapabilityAvailability(
    data,
    actionBusy,
    loading,
    'version:mergePreview',
  );
  const mergeApplyAvailability = firstDisabledAvailability(
    getCapabilityAvailability(data, actionBusy, loading, 'version:mergeApply'),
    getCapabilityAvailability(data, actionBusy, loading, 'version:mergePreview'),
    getCapabilityAvailability(data, actionBusy, loading, 'version:branch'),
    getCapabilityAvailability(data, actionBusy, loading, 'version:checkout'),
  );
  const remotePromotionStatus = getRemotePromotionStatus(data?.surface);
  const canCommit = commitAvailability.enabled;
  const canCreateBranch = branchAvailability.enabled;
  const canCheckout = checkoutAvailability.enabled;
  const canDiff = diffAvailability.enabled;
  const canStageRollback = rollbackAvailability.enabled;
  const canPromoteRemote = remotePromoteAvailability.enabled;
  const mergePreviewDisabledReason = mergePreviewActionDisabledReason(
    mergePreviewAvailability.disabledReason,
    currentMergeTarget,
    selectedMergeSource,
  );
  const canPreviewMerge = mergePreviewAvailability.enabled && !mergePreviewDisabledReason;
  const mergeApplyDisabledReason = mergeApplyActionDisabledReason(
    mergeApplyAvailability.disabledReason,
    currentMergeTarget,
    selectedMergeSource,
    mergePreviewState,
    mergeResolutionSelections,
  );
  const canApplyMerge = mergeApplyAvailability.enabled && !mergeApplyDisabledReason;

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

  const cancelActiveMergeReadAction = useCallback(() => {
    const active = activeActionRef.current;
    if (!active || (active.kind !== 'merge-preview' && active.kind !== 'merge-restore')) {
      return;
    }
    activeActionRef.current = undefined;
    setActionState((current) => (current.status === 'running' ? { status: 'idle' } : current));
  }, []);

  const mergeContextStillCurrent = useCallback((target: VersionMergeTarget, source: VersionRef) => {
    const latest = latestMergeContextRef.current;
    return mergeTargetsMatch(latest.target, target) && mergeSourcesMatch(latest.source, source);
  }, []);

  useEffect(() => {
    if (mergeSources.length === 0) {
      if (mergeSourceRefName !== '') {
        cancelActiveMergeReadAction();
        setMergeSourceRefNameState('');
      }
      return;
    }
    if (!mergeSources.some((ref) => ref.name === mergeSourceRefName)) {
      cancelActiveMergeReadAction();
      setMergeSourceRefNameState(mergeSources[0]!.name);
      setMergePreviewState({ kind: 'idle' });
      setMergeResolutionSelections({});
    }
  }, [cancelActiveMergeReadAction, mergeSourceRefName, mergeSources]);

  const setMergeSourceRefName = useCallback(
    (refName: string) => {
      if (refName === mergeSourceRefName) return;
      cancelActiveMergeReadAction();
      setMergeSourceRefNameState(refName);
      setMergePreviewState({ kind: 'idle' });
      setMergeResolutionSelections({});
      restoredMergeReviewDraftKeyRef.current = undefined;
    },
    [cancelActiveMergeReadAction, mergeSourceRefName],
  );

  useEffect(() => {
    if (
      !data ||
      loading ||
      mergePreviewState.kind !== 'idle' ||
      !currentMergeTarget ||
      !selectedMergeSource
    ) {
      return;
    }

    const draftRead = readMergeReviewDraftForTarget(currentMergeTarget, selectedMergeSource);
    if (!draftRead) return;
    const { key: draftKey, draft } = draftRead;
    if (restoredMergeReviewDraftKeyRef.current === draftKey) return;

    let cancelled = false;
    let completed = false;
    const action = beginAction('merge-restore');
    if (!action) return;
    restoredMergeReviewDraftKeyRef.current = draftKey;

    const restore = async () => {
      if (!setRunningAction(action, 'Restoring merge review')) return;
      const result = await readVersionResult('VERSION_UI_MERGE_PREVIEW_RESTORE_FAILED', () =>
        workbook.version.merge(draft.input, {
          mode: 'preview',
          includeDiagnostics: true,
          ...(currentMergeTarget.refName ? { targetRef: currentMergeTarget.refName } : {}),
          ...mergeExpectedTargetHead(data),
        }),
      );
      if (cancelled || !isActionCurrent(action)) return;
      if (!mergeContextStillCurrent(currentMergeTarget, selectedMergeSource)) {
        restoredMergeReviewDraftKeyRef.current = undefined;
        cancelAction(action);
        return;
      }
      if (!result.ok) {
        clearMergeReviewDraftForTarget(currentMergeTarget, selectedMergeSource);
        completed = completeAction(action, { status: 'idle' });
        return;
      }

      setMergePreviewState({
        kind: 'result',
        input: draft.input,
        result: result.value,
        sourceRefName: selectedMergeSource.name,
        ...(currentMergeTarget.refName ? { targetRefName: currentMergeTarget.refName } : {}),
      });
      setMergeResolutionSelections(sanitizeMergeReviewDraftSelections(result.value, draft));
      completed = completeAction(action, {
        status: 'success',
        message: mergePreviewActionMessage(result.value),
      });
    };

    void restore();

    return () => {
      cancelled = true;
      if (!completed) {
        restoredMergeReviewDraftKeyRef.current = undefined;
        cancelAction(action);
      }
    };
  }, [
    beginAction,
    cancelAction,
    completeAction,
    currentMergeTarget,
    data,
    isActionCurrent,
    loading,
    mergeContextStillCurrent,
    mergePreviewState.kind,
    selectedMergeSource,
    setRunningAction,
    workbook,
  ]);

  const handleCommit = useCallback(async () => {
    if (!data || !canCommit || isCommitDirtyRefreshRequired()) return;
    const action = beginAction('commit');
    if (!action) return;
    const dirtyRefreshFenceData = data;

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

    if (!setRunningAction(action, 'Committing changes')) return;
    const result = await readVersionResult('VERSION_UI_COMMIT_FAILED', () =>
      workbook.version.commit(options),
    );
    if (!isActionCurrent(action)) return;
    if (!result.ok) {
      completeAction(action, { status: 'error', diagnostic: result.diagnostic });
      return;
    }

    markCommitDirtyRefreshRequired(dirtyRefreshFenceData);
    setCommitMessage('');
    setSelectedCommitId(result.value.id);
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

  const handleCreateBranch = useCallback(async () => {
    if (!data || !canCreateBranch || !selectedOrHeadCommitId) return;
    const action = beginAction('branch');
    if (!action) return;

    const normalizedBranch = normalizeVersionBranchNameInput(branchName);
    if (!normalizedBranch.ok) {
      cancelAction(action);
      return;
    }

    const name = normalizedBranch.branch.refName as Parameters<
      WorkbookVersion['createBranch']
    >[0]['name'];
    if (!setRunningAction(action, 'Creating branch')) return;
    const result = await readVersionResult('VERSION_UI_CREATE_BRANCH_FAILED', () =>
      workbook.version.createBranch({
        name,
        targetCommitId: selectedOrHeadCommitId,
        expectedAbsent: true,
      }),
    );
    if (!isActionCurrent(action)) return;
    if (!result.ok) {
      completeAction(action, { status: 'error', diagnostic: result.diagnostic });
      return;
    }

    setBranchName('');
    setSelectedCommitId(result.value.commitId);
    await refreshThenCompleteAction(action, {
      status: 'success',
      message: `Created ${displayBranchName(result.value.name)}`,
    });
  }, [
    beginAction,
    branchName,
    canCreateBranch,
    cancelAction,
    completeAction,
    data,
    isActionCurrent,
    refreshThenCompleteAction,
    selectedOrHeadCommitId,
    setRunningAction,
    workbook,
  ]);

  const handleStageRollback = useCallback(async () => {
    if (!data || !canStageRollback || !selectedOrHeadCommitId) return;
    const action = beginAction('rollback');
    if (!action) return;

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

    if (!setRunningAction(action, 'Staging rollback')) return;
    const result = await readVersionResult('VERSION_UI_REVERT_FAILED', () =>
      workbook.version.revert(input, { dryRun: true, includeDiagnostics: true }),
    );
    if (!isActionCurrent(action)) return;
    if (!result.ok) {
      completeAction(action, { status: 'error', diagnostic: result.diagnostic });
      return;
    }

    if (result.value.status === 'rejected') {
      completeAction(action, {
        status: 'error',
        diagnostic: diagnosticFromRevertResult('VERSION_UI_REVERT_REJECTED', result.value),
      });
      return;
    }

    setRollbackReason('');
    await refreshThenCompleteAction(action, {
      status: 'success',
      message: rollbackActionMessage(result.value, selectedOrHeadCommitId),
    });
  }, [
    beginAction,
    canStageRollback,
    completeAction,
    data,
    isActionCurrent,
    refreshThenCompleteAction,
    rollbackReason,
    selectedOrHeadCommitId,
    setRunningAction,
    workbook,
  ]);

  const handlePromotePendingRemote = useCallback(async () => {
    if (!data || !canPromoteRemote) return;
    const action = beginAction('remote-promote');
    if (!action) return;

    if (!setRunningAction(action, 'Promoting pending remote changes')) return;
    const result = await readVersionResult('VERSION_UI_REMOTE_PROMOTE_FAILED', () =>
      workbook.version.promotePendingRemote({ includeDiagnostics: true }),
    );
    if (!isActionCurrent(action)) return;
    if (!result.ok) {
      completeAction(action, { status: 'error', diagnostic: result.diagnostic });
      return;
    }

    if (result.value.status === 'failed') {
      completeAction(action, {
        status: 'error',
        diagnostic: diagnosticFromRemotePromotionResult(
          'VERSION_UI_REMOTE_PROMOTE_REJECTED',
          result.value,
        ),
      });
      return;
    }

    await refreshThenCompleteAction(action, {
      status: 'success',
      message: remotePromotionActionMessage(result.value),
    });
  }, [
    beginAction,
    canPromoteRemote,
    completeAction,
    data,
    isActionCurrent,
    refreshThenCompleteAction,
    setRunningAction,
    workbook,
  ]);

  const handlePreviewMerge = useCallback(async () => {
    if (!data || !canPreviewMerge || !currentMergeTarget || !selectedMergeSource) return;
    const action = beginAction('merge-preview');
    if (!action) return;

    setMergePreviewState({ kind: 'idle' });
    setMergeResolutionSelections({});
    if (!setRunningAction(action, 'Loading merge history')) return;
    const graphResult = await readMergeGraph(workbook, data, [
      currentMergeTarget.commitId,
      selectedMergeSource.commitId,
    ]);
    if (!isActionCurrent(action)) return;
    if (!mergeContextStillCurrent(currentMergeTarget, selectedMergeSource)) {
      cancelAction(action);
      return;
    }
    if (!graphResult.ok) {
      completeAction(action, { status: 'error', diagnostic: graphResult.diagnostic });
      return;
    }

    const baseResult = findLoadedMergeBase(
      graphResult.commits,
      currentMergeTarget.commitId,
      selectedMergeSource.commitId,
    );
    if (!baseResult.ok) {
      setMergePreviewState({ kind: 'blocked', message: baseResult.reason });
      setMergeResolutionSelections({});
      completeAction(action, { status: 'success', message: 'Merge preview blocked' });
      return;
    }

    const input: VersionMergeInput = {
      base: baseResult.baseCommitId,
      ours: currentMergeTarget.commitId,
      theirs: selectedMergeSource.commitId,
    };
    if (!setRunningAction(action, 'Previewing merge')) return;
    const result = await readVersionResult('VERSION_UI_MERGE_PREVIEW_FAILED', () =>
      workbook.version.merge(input, {
        mode: 'preview',
        includeDiagnostics: true,
        ...(currentMergeTarget.refName ? { targetRef: currentMergeTarget.refName } : {}),
        ...mergeExpectedTargetHead(data),
      }),
    );
    if (!isActionCurrent(action)) return;
    if (!mergeContextStillCurrent(currentMergeTarget, selectedMergeSource)) {
      cancelAction(action);
      return;
    }
    if (!result.ok) {
      completeAction(action, { status: 'error', diagnostic: result.diagnostic });
      return;
    }

    setMergePreviewState({
      kind: 'result',
      input,
      result: result.value,
      sourceRefName: selectedMergeSource.name,
      ...(currentMergeTarget.refName ? { targetRefName: currentMergeTarget.refName } : {}),
    });
    setMergeResolutionSelections({});
    writeMergeReviewDraft(currentMergeTarget, selectedMergeSource, {
      input,
      selections: {},
    });
    completeAction(action, {
      status: 'success',
      message: mergePreviewActionMessage(result.value),
    });
  }, [
    beginAction,
    canPreviewMerge,
    cancelAction,
    completeAction,
    currentMergeTarget,
    data,
    isActionCurrent,
    mergeContextStillCurrent,
    selectedMergeSource,
    setRunningAction,
    workbook,
  ]);

  const handleApplyMerge = useCallback(async () => {
    if (!data || !canApplyMerge || !currentMergeTarget || mergePreviewState.kind !== 'result') {
      return;
    }
    const action = beginAction('merge-apply');
    if (!action) return;
    const dirtyRefreshFenceData = data;
    const targetRef = currentMergeTarget.refName;

    const input = applyMergeInputFromPreview(mergePreviewState.result, mergeResolutionSelections);
    if (!input) {
      cancelAction(action);
      return;
    }

    if (!setRunningAction(action, 'Refreshing merge target')) return;
    const expectedTargetHead = await readCurrentMergeExpectedTargetHead(
      workbook,
      currentMergeTarget,
      mergePreviewState.input.ours,
    );
    if (!isActionCurrent(action)) return;
    if (!expectedTargetHead.ok) {
      completeAction(action, { status: 'error', diagnostic: expectedTargetHead.diagnostic });
      return;
    }
    if (!targetRef) {
      completeAction(action, {
        status: 'error',
        diagnostic: {
          code: 'VERSION_UI_MERGE_TARGET_REF_UNAVAILABLE',
          severity: 'warning',
          message: 'Current branch ref is unavailable.',
        },
      });
      return;
    }

    if (!setRunningAction(action, 'Applying merge')) return;
    const result = await readVersionResult('VERSION_UI_MERGE_APPLY_FAILED', () =>
      workbook.version.applyMerge(
        input,
        materializedActiveCheckoutMergeApplyOptions(targetRef, expectedTargetHead.value),
      ),
    );
    if (!isActionCurrent(action)) return;
    if (!result.ok) {
      completeAction(action, { status: 'error', diagnostic: result.diagnostic });
      return;
    }

    if (mergeApplyBlocked(result.value)) {
      setMergePreviewState({
        kind: 'blocked',
        message: mergeApplyBlockedMessage(result.value),
      });
      setMergeResolutionSelections({});
      if (selectedMergeSource) {
        clearMergeReviewDraftForTarget(currentMergeTarget, selectedMergeSource);
      }
      completeAction(action, {
        status: 'error',
        diagnostic: diagnosticFromMergeApplyResult('VERSION_UI_MERGE_APPLY_BLOCKED', result.value),
      });
      return;
    }

    if (result.value.status === 'conflicted') {
      const message = mergeApplyConflictedMessage();
      setMergePreviewState({
        kind: 'blocked',
        message,
      });
      setMergeResolutionSelections({});
      if (selectedMergeSource) {
        clearMergeReviewDraftForTarget(currentMergeTarget, selectedMergeSource);
      }
      completeAction(action, {
        status: 'error',
        diagnostic: {
          code: 'VERSION_UI_MERGE_APPLY_CONFLICTED',
          severity: 'warning',
          message,
        },
      });
      return;
    }

    markCommitDirtyRefreshRequired(dirtyRefreshFenceData);
    if (selectedMergeSource) {
      clearMergeReviewDraftForTarget(currentMergeTarget, selectedMergeSource);
    }
    setMergePreviewState({ kind: 'idle' });
    setMergeResolutionSelections({});

    setSelectedCommitId('commitRef' in result.value ? result.value.commitRef.id : undefined);
    await refreshThenCompleteAction(action, {
      status: 'success',
      message: mergeApplyActionMessage(result.value),
    });
  }, [
    beginAction,
    canApplyMerge,
    cancelAction,
    completeAction,
    currentMergeTarget,
    data,
    isActionCurrent,
    markCommitDirtyRefreshRequired,
    mergePreviewState,
    mergeResolutionSelections,
    refreshThenCompleteAction,
    selectedMergeSource,
    setRunningAction,
    workbook,
  ]);

  const handleMergeResolutionChange = useCallback(
    (conflictId: string, optionId: string) => {
      setMergeResolutionSelections((current) => {
        const next = { ...current, [conflictId]: optionId };
        if (mergePreviewState.kind === 'result' && currentMergeTarget && selectedMergeSource) {
          writeMergeReviewDraft(currentMergeTarget, selectedMergeSource, {
            input: mergePreviewState.input,
            selections: next,
          });
        }
        return next;
      });
    },
    [currentMergeTarget, mergePreviewState, selectedMergeSource],
  );

  const handleCheckoutRef = useCallback(
    async (ref: VersionRef) => {
      if (!canCheckout) return;
      const action = beginAction('checkout');
      if (!action) return;
      const dirtyRefreshFenceData = data;

      if (!setRunningAction(action, 'Checking out branch')) return;
      const result = await readVersionResult('VERSION_UI_CHECKOUT_FAILED', () =>
        workbook.version.checkout(
          {
            kind: 'ref',
            name: ref.name,
          },
          { includeDiagnostics: true },
        ),
      );
      if (!isActionCurrent(action)) return;
      if (!result.ok) {
        completeAction(action, { status: 'error', diagnostic: result.diagnostic });
        return;
      }

      markCommitDirtyRefreshRequired(dirtyRefreshFenceData);
      setSelectedCommitId(result.value.plan.commitId);
      await refreshThenCompleteAction(action, {
        status: 'success',
        message: `Checked out ${displayBranchName(ref.name)}`,
      });
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
    canApplyMerge,
    canPreviewMerge,
    canPromoteRemote,
    canStageRollback,
    checkoutDisabledReason: checkoutAvailability.disabledReason,
    commitDisabledReason: commitAvailability.disabledReason,
    commitMessage,
    currentMergeTarget,
    diffDisabledReason: diffAvailability.disabledReason,
    diffPreview,
    handleCheckoutRef,
    handleApplyMerge,
    handleCommit,
    handleCreateBranch,
    handleDiffCommit,
    handleMergeResolutionChange,
    handlePromotePendingRemote,
    handlePreviewMerge,
    handleReviewProposalDiff,
    handleStageRollback,
    mergeApplyDisabledReason,
    mergePreviewDisabledReason,
    mergePreviewState,
    mergeResolutionSelections,
    mergeSourceRefName,
    mergeSources,
    remotePromoteDisabledReason: remotePromoteAvailability.disabledReason,
    remotePromotionStatus,
    rollbackDisabledReason: rollbackAvailability.disabledReason,
    rollbackReason,
    selectedCommitId,
    selectedOrHeadCommitId,
    setBranchName,
    setCommitMessage,
    setMergeSourceRefName,
    setRollbackReason,
    setSelectedCommitId,
  };
}
