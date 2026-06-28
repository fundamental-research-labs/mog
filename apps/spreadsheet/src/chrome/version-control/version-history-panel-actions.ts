import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  VersionDiffEntry,
  VersionDiffGroupId,
  VersionDiffOverview,
  VersionMergeConflictResolutionOptionKind,
  VersionMergeReview,
  VersionRef,
  VersionSemanticDiffPage,
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
} from './availability/version-action-availability';
import { type VersionActionState } from './VersionActionStatus';
import {
  versionDiffFiltersFromSelection,
  type VersionDiffFilterSelection,
  type VersionDiffPreview,
} from './VersionHistoryDiffPreview';
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

export type VersionMergeReviewPanelState = {
  readonly sourceRef: VersionRef;
  readonly review: VersionMergeReview;
};

const VERSION_DIFF_DETAIL_PAGE_SIZE = 50;
const VERSION_DIFF_INLINE_DETAIL_MAX_CHANGES = 200;
const VERSION_DIFF_INLINE_DETAIL_PAGE_SIZE = 200;
const VERSION_DIFF_MAX_CACHED_ROWS = 1_000;
const VERSION_DIFF_MAX_CACHED_PAGES = 20;

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
  const [mergeReview, setMergeReview] = useState<VersionMergeReviewPanelState | undefined>();
  const actionSequenceRef = useRef(0);
  const diffGenerationRef = useRef(0);
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
  const mergePreviewAvailability = getCapabilityAvailability(
    data,
    actionBusy,
    loading,
    'version:mergePreview',
  );
  const mergeApplyAvailability = getCapabilityAvailability(
    data,
    actionBusy,
    loading,
    'version:mergeApply',
  );
  const canCommit = commitAvailability.enabled;
  const canCreateBranch = branchAvailability.enabled;
  const canCheckout = checkoutAvailability.enabled;
  const canDiff = diffAvailability.enabled;
  const canPreviewMerge = mergePreviewAvailability.enabled;
  const canApplyMerge = mergeApplyAvailability.enabled;
  const activeParentDiffCommitId = resolveActiveParentDiffCommitId(data?.commits, diffPreview);

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

  const beginDiffLoad = useCallback(() => {
    diffGenerationRef.current += 1;
    return diffGenerationRef.current;
  }, []);

  const isDiffGenerationCurrent = useCallback((generation: number) => {
    return diffGenerationRef.current === generation;
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

  const loadInlineDiffDetail = useCallback(
    async (preview: VersionDiffPreview, generation: number) => {
      if (!preview.inlineDetailMode) return preview;

      const groups = inlineDetailGroups(preview.overview);
      const results = await Promise.all(
        groups.map((group) =>
          readVersionResult('VERSION_UI_DIFF_FAILED', () =>
            workbook.version.diffGroupDetail(preview.base, preview.target, {
              groupId: group.groupId,
              pageSize: VERSION_DIFF_INLINE_DETAIL_PAGE_SIZE,
              includeDiagnostics: true,
              ...diffFilterOptionsInput(preview.filters ?? {}),
            }),
          ),
        ),
      );
      if (!isDiffGenerationCurrent(generation)) return undefined;

      const failed = results.find((result) => !result.ok);
      if (failed && !failed.ok) {
        setActionState({ status: 'error', diagnostic: failed.diagnostic });
        setDiffPreview((current) =>
          current && current.base === preview.base && current.target === preview.target
            ? { ...current, loadingInlineDetail: false }
            : current,
        );
        return undefined;
      }

      return withInlineDetailPages(
        preview,
        results.map((result) => (result.ok ? result.value : undefined)).filter(isDefined),
      );
    },
    [isDiffGenerationCurrent, workbook],
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
          ? workbook.version.refs.createBranch({
              name: normalizedBranch.branch.refName as Parameters<
                WorkbookVersion['refs']['createBranch']
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
      if (!parentId) return;

      if (diffPreview?.base === parentId && diffPreview.target === commit.id) {
        beginDiffLoad();
        setDiffPreview(undefined);
        setActionState({ status: 'idle' });
        return;
      }

      if (!canDiff) return;

      const generation = beginDiffLoad();
      setActionState({ status: 'running', label: 'Loading parent diff' });
      const result = await readVersionResult('VERSION_UI_DIFF_FAILED', () =>
        workbook.version.diffOverview(parentId, commit.id, {
          groupLimit: 50,
          includeDiagnostics: true,
        }),
      );
      if (!isDiffGenerationCurrent(generation)) return;
      if (!result.ok) {
        setActionState({ status: 'error', diagnostic: result.diagnostic });
        return;
      }

      const preview = createDiffPreview(parentId, commit.id, result.value);
      if (preview.inlineDetailMode) {
        const loadingPreview = { ...preview, loadingInlineDetail: true };
        setDiffPreview(loadingPreview);
        const hydratedPreview = await loadInlineDiffDetail(loadingPreview, generation);
        if (!hydratedPreview) return;
        setDiffPreview(hydratedPreview);
      } else {
        setDiffPreview(preview);
      }
      setActionState({ status: 'idle' });
    },
    [beginDiffLoad, canDiff, diffPreview, isDiffGenerationCurrent, loadInlineDiffDetail, workbook],
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
      const generation = beginDiffLoad();
      setActionState({ status: 'running', label: `Loading ${label} diff` });
      const result = await readVersionResult('VERSION_UI_DIFF_FAILED', () =>
        workbook.version.diffOverview(target.baseCommitId, target.targetCommitId, {
          groupLimit: 50,
          includeDiagnostics: true,
        }),
      );
      if (!isDiffGenerationCurrent(generation)) return;
      if (!result.ok) {
        setActionState({ status: 'error', diagnostic: result.diagnostic });
        return;
      }

      const preview = createDiffPreview(target.baseCommitId, target.targetCommitId, result.value);
      if (preview.inlineDetailMode) {
        const loadingPreview = { ...preview, loadingInlineDetail: true };
        setDiffPreview(loadingPreview);
        const hydratedPreview = await loadInlineDiffDetail(loadingPreview, generation);
        if (!hydratedPreview) return;
        setDiffPreview(hydratedPreview);
      } else {
        setDiffPreview(preview);
      }
      setActionState({ status: 'success', message: `Loaded ${label} diff` });
    },
    [beginDiffLoad, canDiff, isDiffGenerationCurrent, loadInlineDiffDetail, workbook],
  );

  const handleLoadMoreDiffGroups = useCallback(async () => {
    const current = diffPreview;
    const cursor = current?.overview.groups.nextCursor;
    if (!current || !cursor || current.loadingGroups) return;
    const generation = diffGenerationRef.current;
    const { base, target } = current;
    setDiffPreview((preview) =>
      preview && preview.base === base && preview.target === target
        ? { ...preview, loadingGroups: true }
        : preview,
    );
    const result = await readVersionResult('VERSION_UI_DIFF_FAILED', () =>
      workbook.version.diffOverview(base, target, {
        groupLimit: current.overview.groups.limit,
        groupPageToken: cursor,
        includeDiagnostics: true,
        ...diffFilterOptionsInput(current.filters ?? {}),
      }),
    );
    if (!isDiffGenerationCurrent(generation)) return;
    if (!result.ok) {
      setActionState({ status: 'error', diagnostic: result.diagnostic });
      setDiffPreview((preview) =>
        preview && preview.base === base && preview.target === target
          ? { ...preview, loadingGroups: false }
          : preview,
      );
      return;
    }
    setDiffPreview((preview) =>
      preview && preview.base === base && preview.target === target
        ? appendDiffOverviewGroups(preview, result.value)
        : preview,
    );
  }, [diffPreview, isDiffGenerationCurrent, workbook]);

  const handleSelectDiffGroup = useCallback(
    async (groupId: VersionDiffGroupId) => {
      const current = diffPreview;
      if (!current) return;
      const generation = diffGenerationRef.current;
      const { base, target } = current;
      setDiffPreview((preview) =>
        preview && preview.base === base && preview.target === target
          ? {
              ...preview,
              activeGroupId: groupId,
              detailPages: [],
              detailItems: [],
              detailNextCursor: undefined,
              loadedDetailCount: 0,
              loadedDetailPageCount: 0,
              hasMoreDetail: false,
              loadingDetail: true,
            }
          : preview,
      );
      const result = await readVersionResult('VERSION_UI_DIFF_FAILED', () =>
        workbook.version.diffGroupDetail(base, target, {
          groupId,
          pageSize: VERSION_DIFF_DETAIL_PAGE_SIZE,
          includeDiagnostics: true,
          ...diffFilterOptionsInput(current.filters ?? {}),
        }),
      );
      if (!isDiffGenerationCurrent(generation)) return;
      if (!result.ok) {
        setActionState({ status: 'error', diagnostic: result.diagnostic });
        setDiffPreview((preview) =>
          preview && preview.base === base && preview.target === target
            ? { ...preview, loadingDetail: false }
            : preview,
        );
        return;
      }
      setDiffPreview((preview) =>
        preview && preview.base === base && preview.target === target
          ? replaceDiffDetailPage(preview, groupId, result.value)
          : preview,
      );
    },
    [diffPreview, isDiffGenerationCurrent, workbook],
  );

  const handleLoadMoreDiffDetail = useCallback(async () => {
    const current = diffPreview;
    if (
      !current ||
      !current.activeGroupId ||
      !current.detailNextCursor ||
      current.loadingDetail
    ) {
      return;
    }
    const generation = diffGenerationRef.current;
    const { base, target, activeGroupId, detailNextCursor } = current;
    setDiffPreview((preview) =>
      preview && preview.base === base && preview.target === target
        ? { ...preview, loadingDetail: true }
        : preview,
    );
    const result = await readVersionResult('VERSION_UI_DIFF_FAILED', () =>
      workbook.version.diffGroupDetail(base, target, {
        groupId: activeGroupId,
        pageToken: detailNextCursor,
        pageSize: VERSION_DIFF_DETAIL_PAGE_SIZE,
        includeDiagnostics: true,
        ...diffFilterOptionsInput(current.filters ?? {}),
      }),
    );
    if (!isDiffGenerationCurrent(generation)) return;
    if (!result.ok) {
      setActionState({ status: 'error', diagnostic: result.diagnostic });
      setDiffPreview((preview) =>
        preview && preview.base === base && preview.target === target
          ? { ...preview, loadingDetail: false }
          : preview,
      );
      return;
    }
    setDiffPreview((preview) =>
      preview && preview.base === base && preview.target === target
        ? appendDiffDetailPage(preview, activeGroupId, result.value)
        : preview,
    );
  }, [diffPreview, isDiffGenerationCurrent, workbook]);

  const handleDiffFiltersChange = useCallback(
    async (filters: VersionDiffFilterSelection) => {
      const current = diffPreview;
      if (!current) return;
      const generation = beginDiffLoad();
      const { base, target } = current;
      setDiffPreview({
        ...current,
        filters,
        activeGroupId: undefined,
        detailPages: [],
        detailItems: [],
        detailNextCursor: undefined,
        loadedDetailCount: 0,
        loadedDetailPageCount: 0,
        hasMoreDetail: false,
        loadingGroups: true,
        loadingDetail: false,
      });
      const result = await readVersionResult('VERSION_UI_DIFF_FAILED', () =>
        workbook.version.diffOverview(base, target, {
          groupLimit: 50,
          includeDiagnostics: true,
          ...diffFilterOptionsInput(filters),
        }),
      );
      if (!isDiffGenerationCurrent(generation)) return;
      if (!result.ok) {
        setActionState({ status: 'error', diagnostic: result.diagnostic });
        setDiffPreview((preview) =>
          preview && preview.base === base && preview.target === target
            ? { ...preview, loadingGroups: false }
            : preview,
        );
        return;
      }
      const nextPreview = createDiffPreview(base, target, result.value, filters);
      if (nextPreview.inlineDetailMode) {
        const loadingPreview = { ...nextPreview, loadingInlineDetail: true };
        setDiffPreview(loadingPreview);
        const hydratedPreview = await loadInlineDiffDetail(loadingPreview, generation);
        if (!hydratedPreview) return;
        setDiffPreview(hydratedPreview);
      } else {
        setDiffPreview(nextPreview);
      }
      setActionState({ status: 'idle' });
    },
    [beginDiffLoad, diffPreview, isDiffGenerationCurrent, loadInlineDiffDetail, workbook],
  );

  const handlePreviewMerge = useCallback(
    async (sourceRef: VersionRef) => {
      if (!canPreviewMerge) return;
      const action = beginAction('merge-preview');
      if (!action) return;

      const normalizedBranch = normalizeVersionBranchNameInput(sourceRef.name);
      const source =
        normalizedBranch.ok ? normalizedBranch.branch.branchName : displayBranchName(sourceRef.name);

      if (!setRunningAction(action, 'Previewing merge')) return;
      const result = await readVersionResult('VERSION_UI_MERGE_PREVIEW_FAILED', () =>
        workbook.version.previewMerge(
          { from: source, into: 'current' },
          { includeDiagnostics: true, persistReviewRecord: true },
        ),
      );
      if (!isActionCurrent(action)) return;
      if (!result.ok) {
        completeAction(action, { status: 'error', diagnostic: result.diagnostic });
        return;
      }

      setMergeReview({ sourceRef, review: result.value });
      completeAction(action, {
        status: 'success',
        message: mergeReviewStatusMessage(result.value),
      });
    },
    [
      beginAction,
      canPreviewMerge,
      completeAction,
      isActionCurrent,
      setRunningAction,
      workbook,
    ],
  );

  const handleChooseMergeResolution = useCallback(
    (conflictId: string, kind: VersionMergeConflictResolutionOptionKind) => {
      setMergeReview((current) =>
        current
          ? {
              ...current,
              review: current.review.choose(conflictId, kind),
            }
          : current,
      );
    },
    [],
  );

  const handleApplyMerge = useCallback(async () => {
    if (!mergeReview || !canApplyMerge) return;
    const action = beginAction('merge-apply');
    if (!action) return;

    if (!setRunningAction(action, 'Applying merge')) return;
    const result = await readVersionResult('VERSION_UI_MERGE_APPLY_FAILED', () =>
      mergeReview.review.apply({
        includeDiagnostics: true,
        materializeActiveCheckout: true,
      }),
    );
    if (!isActionCurrent(action)) return;
    if (!result.ok) {
      completeAction(action, { status: 'error', diagnostic: result.diagnostic });
      return;
    }

    setMergeReview(undefined);
    await refreshThenCompleteAction(action, {
      status: 'success',
      message: `Applied merge from ${displayBranchName(mergeReview.sourceRef.name)}`,
    });
  }, [
    beginAction,
    canApplyMerge,
    completeAction,
    isActionCurrent,
    mergeReview,
    refreshThenCompleteAction,
    setRunningAction,
  ]);

  return {
    actionState,
    activeParentDiffCommitId,
    branchDisabledReason: branchAvailability.disabledReason,
    branchName,
    canCheckout,
    canCommit,
    canCreateBranch,
    canDiff,
    canApplyMerge,
    canPreviewMerge,
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
    handleLoadMoreDiffDetail,
    handleLoadMoreDiffGroups,
    handleDiffFiltersChange,
    handleApplyMerge,
    handleChooseMergeResolution,
    handlePreviewMerge,
    handleReviewProposalDiff,
    handleSelectDiffGroup,
    currentOrHeadCommitId,
    mergeApplyDisabledReason: mergeApplyAvailability.disabledReason,
    mergePreviewDisabledReason: mergePreviewAvailability.disabledReason,
    mergeReview,
    setBranchName,
    setCommitMessage,
  };
}

function resolveActiveParentDiffCommitId(
  commits: readonly WorkbookCommitSummary[] | undefined,
  diffPreview: VersionDiffPreview | undefined,
): WorkbookCommitId | undefined {
  if (!commits || !diffPreview) return undefined;
  return commits.find(
    (commit) => commit.id === diffPreview.target && commit.parents[0] === diffPreview.base,
  )?.id;
}

function mergeReviewStatusMessage(review: VersionMergeReview): string {
  if (review.status === 'conflicted') {
    return `Merge preview has ${review.conflicts.length} conflicts`;
  }
  if (review.status === 'clean') return 'Previewed clean merge';
  if (review.status === 'fastForward') return 'Merge preview ready to apply';
  if (review.status === 'alreadyMerged') return 'Branch is already merged';
  return 'Merge preview blocked';
}

function createDiffPreview(
  base: WorkbookCommitId,
  target: WorkbookCommitId,
  overview: VersionDiffOverview,
  filters: VersionDiffFilterSelection = {},
): VersionDiffPreview {
  const inlineDetailMode = shouldInlineDiffDetail(overview);
  return {
    base,
    target,
    overview,
    filters,
    detailPages: [],
    detailItems: [],
    loadedDetailCount: 0,
    loadedDetailPageCount: 0,
    hasMoreDetail: false,
    loadingGroups: false,
    loadingDetail: false,
    inlineDetailMode,
    inlineDetailItems: [],
    loadingInlineDetail: false,
    inlineDetailHasMore: false,
  };
}

function appendDiffOverviewGroups(
  preview: VersionDiffPreview,
  overviewPage: VersionDiffOverview,
): VersionDiffPreview {
  return {
    ...preview,
    overview: {
      ...overviewPage,
      groups: {
        ...overviewPage.groups,
        items: [...preview.overview.groups.items, ...overviewPage.groups.items],
      },
    },
    loadingGroups: false,
  };
}

function replaceDiffDetailPage(
  preview: VersionDiffPreview,
  groupId: VersionDiffGroupId,
  page: VersionSemanticDiffPage,
): VersionDiffPreview {
  const bounded = boundedDetailCache([page]);
  return {
    ...preview,
    activeGroupId: groupId,
    detailPages: bounded.pages,
    detailItems: bounded.items,
    detailNextCursor: page.nextCursor,
    loadedDetailCount: bounded.items.length,
    loadedDetailPageCount: bounded.pages.length,
    hasMoreDetail: Boolean(page.nextCursor),
    loadingDetail: false,
  };
}

function appendDiffDetailPage(
  preview: VersionDiffPreview,
  groupId: VersionDiffGroupId,
  page: VersionSemanticDiffPage,
): VersionDiffPreview {
  if (preview.activeGroupId !== groupId) return preview;
  const bounded = boundedDetailCache([...preview.detailPages, page]);
  return {
    ...preview,
    detailPages: bounded.pages,
    detailItems: bounded.items,
    detailNextCursor: page.nextCursor,
    loadedDetailCount: bounded.items.length,
    loadedDetailPageCount: bounded.pages.length,
    hasMoreDetail: Boolean(page.nextCursor),
    loadingDetail: false,
  };
}

function boundedDetailCache(pages: readonly VersionSemanticDiffPage[]): {
  readonly pages: readonly VersionSemanticDiffPage[];
  readonly items: readonly VersionDiffEntry[];
} {
  const retainedPages = pages.slice(-VERSION_DIFF_MAX_CACHED_PAGES);
  const retainedItems: VersionDiffEntry[] = [];
  const boundedPages: VersionSemanticDiffPage[] = [];
  for (const page of retainedPages.slice().reverse()) {
    if (retainedItems.length >= VERSION_DIFF_MAX_CACHED_ROWS) break;
    const remaining = VERSION_DIFF_MAX_CACHED_ROWS - retainedItems.length;
    const items = page.items.slice(-remaining);
    retainedItems.unshift(...items);
    boundedPages.unshift(page);
  }
  return { pages: boundedPages, items: retainedItems };
}

function shouldInlineDiffDetail(overview: VersionDiffOverview): boolean {
  const total = overview.summary.exactTotalChanges;
  if (total === undefined || total === 0 || total > VERSION_DIFF_INLINE_DETAIL_MAX_CHANGES) {
    return false;
  }
  if (overview.groups.nextCursor) return false;
  const groups = inlineDetailGroups(overview);
  return groups.length > 0 && groups.length === overview.groups.items.length;
}

function inlineDetailGroups(overview: VersionDiffOverview): VersionDiffOverview['groups']['items'] {
  return overview.groups.items.filter((group) => group.hasDetail !== false);
}

function withInlineDetailPages(
  preview: VersionDiffPreview,
  pages: readonly VersionSemanticDiffPage[],
): VersionDiffPreview {
  const items = pages.flatMap((page) => page.items);
  return {
    ...preview,
    detailPages: pages,
    detailItems: items,
    loadedDetailCount: items.length,
    loadedDetailPageCount: pages.length,
    hasMoreDetail: pages.some((page) => Boolean(page.nextCursor)),
    inlineDetailItems: items,
    inlineDetailHasMore: pages.some((page) => Boolean(page.nextCursor)),
    loadingInlineDetail: false,
  };
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function diffFilterOptionsInput(
  filters: VersionDiffFilterSelection,
): { readonly filters?: ReturnType<typeof versionDiffFiltersFromSelection> } {
  const options = versionDiffFiltersFromSelection(filters);
  return options ? { filters: options } : {};
}
