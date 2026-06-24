import type { VersionDiagnosticPublicPayload, VersionRevertTarget } from '@mog-sdk/contracts/api';

import type { WorkbookCommit } from '../commit-store';
import type { VersionGraphRef } from '../graph';
import { revertDiagnostic } from './diagnostics';
import type { RevertPlan } from './types';

export function planTopOfRefRevert(
  target: VersionRevertTarget,
  current: VersionGraphRef,
  commitsById: ReadonlyMap<string, WorkbookCommit>,
): RevertPlan {
  switch (target.kind) {
    case 'commit':
      return planCommitRevert(target, current, commitsById);
    case 'range':
      return planRangeRevert(target, current, commitsById);
    case 'mergeCommit':
      return planMergeCommitRevert(target, current, commitsById);
  }
}

function planCommitRevert(
  target: Extract<VersionRevertTarget, { readonly kind: 'commit' }>,
  current: VersionGraphRef,
  commitsById: ReadonlyMap<string, WorkbookCommit>,
): RevertPlan {
  const targetCommit = commitsById.get(target.commitId);
  if (!targetCommit) return rejectedHistoryGap(target, { commitId: target.commitId });
  if (current.commitId !== target.commitId) {
    return requiresReview(target, {
      reason: 'nonTipCommitRevert',
      expectedHead: target.commitId,
      actualHead: current.commitId,
      targetRef: current.name,
    });
  }

  const parentId = targetCommit.payload.parentCommitIds[0];
  if (!parentId) {
    return rejectedHistoryGap(target, { reason: 'rootCommitRevert', commitId: target.commitId });
  }
  const restoreCommit = commitsById.get(parentId);
  if (!restoreCommit) return rejectedHistoryGap(target, { commitId: parentId });
  return { ok: true, restoreCommit, commitsToInvert: [targetCommit] };
}

function planRangeRevert(
  target: Extract<VersionRevertTarget, { readonly kind: 'range' }>,
  current: VersionGraphRef,
  commitsById: ReadonlyMap<string, WorkbookCommit>,
): RevertPlan {
  if (current.commitId !== target.headCommitId) {
    return requiresReview(target, {
      reason: 'nonTipRangeRevert',
      expectedHead: target.headCommitId,
      actualHead: current.commitId,
      targetRef: current.name,
    });
  }

  const restoreCommit = commitsById.get(target.baseCommitId);
  if (!restoreCommit) return rejectedHistoryGap(target, { commitId: target.baseCommitId });

  const path = firstParentPathExclusive(target.headCommitId, target.baseCommitId, commitsById);
  if (!path) {
    return rejectedHistoryGap(target, {
      reason: 'baseNotFirstParentAncestor',
      baseCommitId: target.baseCommitId,
      headCommitId: target.headCommitId,
    });
  }
  return { ok: true, restoreCommit, commitsToInvert: path };
}

function planMergeCommitRevert(
  target: Extract<VersionRevertTarget, { readonly kind: 'mergeCommit' }>,
  current: VersionGraphRef,
  commitsById: ReadonlyMap<string, WorkbookCommit>,
): RevertPlan {
  const mergeCommit = commitsById.get(target.commitId);
  if (!mergeCommit) return rejectedHistoryGap(target, { commitId: target.commitId });
  if (current.commitId !== target.commitId) {
    return requiresReview(target, {
      reason: 'nonTipMergeCommitRevert',
      expectedHead: target.commitId,
      actualHead: current.commitId,
      targetRef: current.name,
    });
  }
  if (target.mainlineParent !== 1) {
    return requiresReview(target, {
      reason: 'nonFirstMainlineParentRequiresHistoricalSemanticDiff',
      commitId: target.commitId,
      mainlineParent: target.mainlineParent,
    });
  }

  const restoreCommitId = mergeCommit.payload.parentCommitIds[target.mainlineParent - 1];
  if (!restoreCommitId) {
    return rejectedHistoryGap(target, {
      reason: 'missingMainlineParent',
      commitId: target.commitId,
      mainlineParent: target.mainlineParent,
    });
  }
  const restoreCommit = commitsById.get(restoreCommitId);
  if (!restoreCommit) return rejectedHistoryGap(target, { commitId: restoreCommitId });
  return { ok: true, restoreCommit, commitsToInvert: [mergeCommit] };
}

function firstParentPathExclusive(
  headCommitId: string,
  baseCommitId: string,
  commitsById: ReadonlyMap<string, WorkbookCommit>,
): readonly WorkbookCommit[] | null {
  const path: WorkbookCommit[] = [];
  let cursor = commitsById.get(headCommitId);

  while (cursor) {
    if (cursor.id === baseCommitId) return path;
    path.push(cursor);
    const parentId = cursor.payload.parentCommitIds[0];
    if (!parentId) return null;
    cursor = commitsById.get(parentId);
  }

  return null;
}

function requiresReview(
  target: VersionRevertTarget,
  payload: VersionDiagnosticPublicPayload,
): RevertPlan {
  return {
    ok: false,
    result: {
      schemaVersion: 1,
      status: 'requires-review',
      target,
      diagnostics: [
        revertDiagnostic(
          'VERSION_REVERT_REQUIRES_REVIEW',
          'Version revert requires a review workflow for this target shape.',
          payload,
          'unsupported',
          'ref-not-mutated',
        ),
      ],
      mutationGuarantee: 'ref-not-mutated',
    },
  };
}

function rejectedHistoryGap(
  target: VersionRevertTarget,
  payload: VersionDiagnosticPublicPayload,
): RevertPlan {
  return {
    ok: false,
    result: {
      schemaVersion: 1,
      status: 'rejected',
      target,
      diagnostics: [
        revertDiagnostic(
          'VERSION_REVERT_HISTORY_GAP',
          'Version revert target is not fully reachable from the target ref history.',
          payload,
          'repair',
          'ref-not-mutated',
        ),
      ],
      mutationGuarantee: 'ref-not-mutated',
    },
  };
}
