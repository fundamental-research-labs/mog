import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  VersionApplyMergeInput,
  VersionApplyMergeResolution,
  VersionApplyMergeResult,
  VersionMergeInput,
  VersionMergeResult,
  VersionRef,
  VersionRevertInput,
  VersionStoreDiagnostic,
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
} from './version-action-availability';
import {
  diagnosticFromRemotePromotionResult,
  getRemotePromotionStatus,
  remotePromotionActionMessage,
  type VersionPanelDiagnostic,
  type VersionActionState,
} from './VersionActionStatus';
import type { VersionDiffPreview } from './VersionHistoryDiffPreview';
import type { ReviewProposalDiffTarget } from './ReviewProposalSurface';
import { displayBranchName, normalizeVersionBranchNameInput } from './version-branch-name';
import { shortCommitId } from './version-history-format';
import {
  diagnosticFromRevertResult,
  readVersionResult,
  resolveSelectedOrHeadCommitId,
  rollbackActionMessage,
  type VersionHistoryData,
  type VersionHistoryWorkbook,
} from './version-history-panel-data';
import {
  findLoadedMergeBase,
  mergeSourceRefs,
  resolveCurrentMergeTarget,
} from './version-merge-planning';
import {
  clearMergeReviewDraft,
  mergeReviewDraftMatches,
  mergeReviewDraftStorageKey,
  readMergeReviewDraft,
  sanitizeMergeReviewDraftSelections,
  writeMergeReviewDraft,
} from './version-merge-review-draft-storage';

type UseVersionHistoryPanelActionsInput = {
  readonly workbook: VersionHistoryWorkbook;
  readonly data?: VersionHistoryData;
  readonly loading: boolean;
  readonly load: () => Promise<void>;
};

const MERGE_GRAPH_PAGE_SIZE = 100;

export type VersionMergePreviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'blocked'; readonly message: string }
  | {
      readonly kind: 'result';
      readonly input: VersionMergeInput;
      readonly result: VersionMergeResult;
      readonly sourceRefName: string;
      readonly targetRefName?: string;
    };

export type VersionMergeResolutionSelections = Readonly<Record<string, string>>;

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

  useEffect(() => {
    if (mergeSources.length === 0) {
      if (mergeSourceRefName !== '') setMergeSourceRefNameState('');
      return;
    }
    if (!mergeSources.some((ref) => ref.name === mergeSourceRefName)) {
      setMergeSourceRefNameState(mergeSources[0]!.name);
      setMergePreviewState({ kind: 'idle' });
      setMergeResolutionSelections({});
    }
  }, [mergeSourceRefName, mergeSources]);

  const setMergeSourceRefName = useCallback((refName: string) => {
    setMergeSourceRefNameState(refName);
    setMergePreviewState({ kind: 'idle' });
    setMergeResolutionSelections({});
    restoredMergeReviewDraftKeyRef.current = undefined;
  }, []);

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

    const draftKey = mergeReviewDraftStorageKey(currentMergeTarget, selectedMergeSource);
    if (restoredMergeReviewDraftKeyRef.current === draftKey) return;
    const draft = readMergeReviewDraft(draftKey);
    if (!draft || !mergeReviewDraftMatches(draft, currentMergeTarget, selectedMergeSource)) {
      return;
    }

    restoredMergeReviewDraftKeyRef.current = draftKey;
    let cancelled = false;

    const restore = async () => {
      setActionState({ status: 'running', label: 'Restoring merge review' });
      const result = await readVersionResult('VERSION_UI_MERGE_PREVIEW_RESTORE_FAILED', () =>
        workbook.version.merge(draft.input, {
          mode: 'preview',
          includeDiagnostics: true,
          ...(currentMergeTarget.refName ? { targetRef: currentMergeTarget.refName } : {}),
          ...mergeExpectedTargetHead(data),
        }),
      );
      if (cancelled) return;
      if (!result.ok) {
        clearMergeReviewDraft(draftKey);
        setActionState({ status: 'idle' });
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
      setActionState({ status: 'success', message: mergePreviewActionMessage(result.value) });
    };

    void restore();

    return () => {
      cancelled = true;
    };
  }, [
    currentMergeTarget,
    data,
    loading,
    mergePreviewState.kind,
    selectedMergeSource,
    workbook,
  ]);

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

  const handlePreviewMerge = useCallback(async () => {
    if (!data || !canPreviewMerge || !currentMergeTarget || !selectedMergeSource) return;

    setMergePreviewState({ kind: 'idle' });
    setMergeResolutionSelections({});
    setActionState({ status: 'running', label: 'Loading merge history' });
    const graphResult = await readMergeGraph(workbook, data, [
      currentMergeTarget.commitId,
      selectedMergeSource.commitId,
    ]);
    if (!graphResult.ok) {
      setActionState({ status: 'error', diagnostic: graphResult.diagnostic });
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
      setActionState({ status: 'success', message: 'Merge preview blocked' });
      return;
    }

    const input: VersionMergeInput = {
      base: baseResult.baseCommitId,
      ours: currentMergeTarget.commitId,
      theirs: selectedMergeSource.commitId,
    };
    setActionState({ status: 'running', label: 'Previewing merge' });
    const result = await readVersionResult('VERSION_UI_MERGE_PREVIEW_FAILED', () =>
      workbook.version.merge(input, {
        mode: 'preview',
        includeDiagnostics: true,
        ...(currentMergeTarget.refName ? { targetRef: currentMergeTarget.refName } : {}),
        ...mergeExpectedTargetHead(data),
      }),
    );
    if (!result.ok) {
      setActionState({ status: 'error', diagnostic: result.diagnostic });
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
    setActionState({ status: 'success', message: mergePreviewActionMessage(result.value) });
  }, [canPreviewMerge, currentMergeTarget, data, selectedMergeSource, workbook]);

  const handleApplyMerge = useCallback(async () => {
    if (!data || !canApplyMerge || !currentMergeTarget || mergePreviewState.kind !== 'result') {
      return;
    }

    const input = applyMergeInputFromPreview(
      mergePreviewState.result,
      mergeResolutionSelections,
    );
    if (!input) return;

    setActionState({ status: 'running', label: 'Applying merge' });
    const result = await readVersionResult('VERSION_UI_MERGE_APPLY_FAILED', () =>
      workbook.version.applyMerge(input, {
        mode: 'apply',
        includeDiagnostics: true,
        ...(currentMergeTarget.refName ? { targetRef: currentMergeTarget.refName } : {}),
        ...mergeExpectedTargetHead(data),
      }),
    );
    if (!result.ok) {
      setActionState({ status: 'error', diagnostic: result.diagnostic });
      return;
    }

    if (mergeApplyBlocked(result.value)) {
      setMergePreviewState({
        kind: 'blocked',
        message: mergeApplyBlockedMessage(result.value),
      });
      setActionState({
        status: 'error',
        diagnostic: diagnosticFromMergeApplyResult('VERSION_UI_MERGE_APPLY_BLOCKED', result.value),
      });
      return;
    }

    if (result.value.status === 'conflicted') {
      setActionState({
        status: 'error',
        diagnostic: {
          code: 'VERSION_UI_MERGE_APPLY_CONFLICTED',
          severity: 'warning',
          message: 'Merge still has unresolved conflicts. Refresh the preview and resolve again.',
        },
      });
      return;
    }

    if ('commitRef' in result.value) {
      const checkoutTarget = result.value.commitRef.refName
        ? { kind: 'ref' as const, name: result.value.commitRef.refName }
        : { kind: 'commit' as const, id: result.value.commitRef.id };
      setActionState({ status: 'running', label: 'Materializing merge' });
      const checkoutResult = await readVersionResult('VERSION_UI_MERGE_CHECKOUT_FAILED', () =>
        workbook.version.checkout(checkoutTarget, { includeDiagnostics: true }),
      );
      if (!checkoutResult.ok) {
        setActionState({ status: 'error', diagnostic: checkoutResult.diagnostic });
        return;
      }
      setSelectedCommitId(checkoutResult.value.plan.commitId);
    } else {
      setSelectedCommitId(undefined);
    }
    if (selectedMergeSource) {
      clearMergeReviewDraft(mergeReviewDraftStorageKey(currentMergeTarget, selectedMergeSource));
    }
    setMergePreviewState({ kind: 'idle' });
    setMergeResolutionSelections({});
    setActionState({ status: 'running', label: 'Refreshing version history' });
    await load();
    setActionState({ status: 'success', message: mergeApplyActionMessage(result.value) });
  }, [
    canApplyMerge,
    currentMergeTarget,
    data,
    load,
    mergePreviewState,
    mergeResolutionSelections,
    workbook,
  ]);

  const handleMergeResolutionChange = useCallback(
    (conflictId: string, optionId: string) => {
      setMergeResolutionSelections((current) => {
        const next = { ...current, [conflictId]: optionId };
        if (
          mergePreviewState.kind === 'result' &&
          currentMergeTarget &&
          selectedMergeSource
        ) {
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

function firstDisabledAvailability<T extends { readonly enabled: boolean }>(
  ...availabilities: readonly (T & { readonly disabledReason?: string })[]
): T & { readonly disabledReason?: string } {
  return (
    availabilities.find((availability) => !availability.enabled) ?? availabilities[0]!
  );
}

function mergePreviewActionDisabledReason(
  availabilityReason: string | undefined,
  currentTarget: ReturnType<typeof resolveCurrentMergeTarget>,
  selectedSource: VersionRef | undefined,
): string | undefined {
  if (availabilityReason) return availabilityReason;
  if (!currentTarget) return 'Current head is unavailable.';
  if (!selectedSource) return 'Choose a source branch or ref.';
  return undefined;
}

function mergeApplyActionDisabledReason(
  availabilityReason: string | undefined,
  currentTarget: ReturnType<typeof resolveCurrentMergeTarget>,
  selectedSource: VersionRef | undefined,
  previewState: VersionMergePreviewState,
  selections: VersionMergeResolutionSelections,
): string | undefined {
  if (availabilityReason) return availabilityReason;
  if (!currentTarget?.refName) return 'Current branch ref is unavailable.';
  if (previewState.kind === 'idle') return 'Preview a merge first.';
  if (previewState.kind === 'blocked') return 'Resolve the blocked preview before applying.';

  const { result } = previewState;
  if (
    previewState.input.ours !== currentTarget.commitId ||
    previewState.targetRefName !== currentTarget.refName ||
    !selectedSource ||
    previewState.input.theirs !== selectedSource.commitId ||
    previewState.sourceRefName !== selectedSource.name
  ) {
    return 'Preview this merge again before applying.';
  }
  if (result.status === 'blocked') return mergeBlockedMessage(result.diagnostics);
  if (result.attemptKind === 'reviewOnly') return 'This merge preview is review-only.';
  if (result.status === 'conflicted' && !mergeConflictsResolved(result, selections)) {
    return 'Select a resolution for each conflict.';
  }
  return undefined;
}

async function readMergeGraph(
  workbook: VersionHistoryWorkbook,
  data: VersionHistoryData,
  starts: readonly WorkbookCommitId[],
): Promise<
  | { readonly ok: true; readonly commits: readonly WorkbookCommitSummary[] }
  | { readonly ok: false; readonly diagnostic: VersionPanelDiagnostic }
> {
  const reads = await Promise.all(
    starts.map((from) =>
      readVersionResult('VERSION_UI_MERGE_HISTORY_FAILED', () =>
        workbook.version.listCommits({
          from,
          pageSize: MERGE_GRAPH_PAGE_SIZE,
          includeDiagnostics: true,
        }),
      ),
    ),
  );
  const failed = reads.find(
    (read): read is Extract<(typeof reads)[number], { readonly ok: false }> => !read.ok,
  );
  if (failed) return { ok: false, diagnostic: failed.diagnostic };

  const byId = new Map<WorkbookCommitId, WorkbookCommitSummary>();
  for (const commit of data.commits) byId.set(commit.id, commit);
  for (const read of reads) {
    if (!read.ok) continue;
    for (const commit of read.value.items) byId.set(commit.id, commit);
  }
  return { ok: true, commits: [...byId.values()] };
}

function mergeExpectedTargetHead(
  data: VersionHistoryData,
): Pick<NonNullable<Parameters<WorkbookVersion['merge']>[1]>, 'expectedTargetHead'> {
  return data.head?.id && data.head.refRevision
    ? { expectedTargetHead: { commitId: data.head.id, revision: data.head.refRevision } }
    : {};
}

function applyMergeInputFromPreview(
  result: VersionMergeResult,
  selections: VersionMergeResolutionSelections,
): VersionApplyMergeInput | undefined {
  if (result.status === 'blocked') return undefined;

  const resolutions =
    result.status === 'conflicted' ? mergeConflictResolutions(result, selections) : [];
  const resolutionPayload = resolutions.length > 0 ? { resolutions } : {};

  if (result.resultId && result.resultDigest) {
    return {
      resultId: result.resultId,
      resultDigest: result.resultDigest,
      ...(result.previewArtifactDigest
        ? { previewArtifactDigest: result.previewArtifactDigest }
        : {}),
      ...(result.resolutionSetDigest ? { resolutionSetDigest: result.resolutionSetDigest } : {}),
      ...(result.resolvedAttemptDigest
        ? { resolvedAttemptDigest: result.resolvedAttemptDigest }
        : {}),
      ...resolutionPayload,
    };
  }

  return {
    base: result.base,
    ours: result.ours,
    theirs: result.theirs,
    ...resolutionPayload,
  };
}

function mergeConflictResolutions(
  result: Extract<VersionMergeResult, { readonly status: 'conflicted' }>,
  selections: VersionMergeResolutionSelections,
): readonly VersionApplyMergeResolution[] {
  return result.conflicts
    .map((conflict) => {
      const optionId = selections[conflict.conflictId];
      const option = conflict.resolutionOptions.find(
        (candidate) => candidate.optionId === optionId,
      );
      if (!option) return undefined;
      return {
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflict.conflictDigest,
        optionId: option.optionId,
        kind: option.kind,
      };
    })
    .filter((resolution): resolution is VersionApplyMergeResolution => Boolean(resolution));
}

function mergeConflictsResolved(
  result: Extract<VersionMergeResult, { readonly status: 'conflicted' }>,
  selections: VersionMergeResolutionSelections,
): boolean {
  return result.conflicts.every((conflict) =>
    conflict.resolutionOptions.some(
      (option) => option.optionId === selections[conflict.conflictId],
    ),
  );
}

function mergePreviewActionMessage(result: VersionMergeResult): string {
  if (result.status === 'clean') {
    return `Merge preview clean with ${formatCount(result.changes.length, 'change')}`;
  }
  if (result.status === 'conflicted') {
    return `Merge preview has ${formatCount(result.conflicts.length, 'conflict')}`;
  }
  if (result.status === 'fastForward') return 'Merge preview can fast-forward';
  if (result.status === 'alreadyMerged') return 'Source is already merged';
  return 'Merge preview blocked';
}

function mergeApplyActionMessage(result: VersionApplyMergeResult): string {
  if (result.status === 'applied') return `Merge applied at ${shortCommitId(result.commitRef.id)}`;
  if (result.status === 'fastForwarded') {
    return `Fast-forwarded to ${shortCommitId(result.commitRef.id)}`;
  }
  if (result.status === 'alreadyApplied') return 'Merge was already applied';
  if (result.status === 'alreadyMerged') return 'Source was already merged';
  if (result.status === 'planned') return 'Merge apply planned';
  return 'Merge apply finished';
}

function mergeApplyBlocked(result: VersionApplyMergeResult): boolean {
  return result.status === 'blocked' || result.status === 'staleTargetHead';
}

function mergeApplyBlockedMessage(result: VersionApplyMergeResult): string {
  if (result.status === 'staleTargetHead') {
    return mergeBlockedMessage(result.diagnostics, 'Current branch moved. Refresh before merging.');
  }
  if (result.status === 'blocked') return mergeBlockedMessage(result.diagnostics);
  return 'Merge apply was blocked.';
}

function diagnosticFromMergeApplyResult(
  code: string,
  result: VersionApplyMergeResult,
): VersionPanelDiagnostic {
  return {
    code,
    severity: panelSeverity(result.diagnostics[0]?.severity ?? 'warning'),
    message: mergeApplyBlockedMessage(result),
  };
}

function mergeBlockedMessage(
  diagnostics: readonly VersionStoreDiagnostic[],
  fallback = 'Merge was blocked.',
): string {
  return (
    diagnostics.find((diagnostic) => diagnostic.safeMessage.trim().length > 0)?.safeMessage ??
    fallback
  );
}

function panelSeverity(
  severity: VersionStoreDiagnostic['severity'],
): VersionPanelDiagnostic['severity'] {
  return severity === 'fatal' ? 'error' : severity;
}

function formatCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}
