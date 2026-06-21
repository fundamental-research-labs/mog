import type {
  VersionApplyMergeResult,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

export function plannedAncestryApplyMergeResult(input: {
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
}): VersionApplyMergeResult {
  return {
    status: 'planned',
    base: input.base,
    ours: input.ours,
    theirs: input.theirs,
    changes: [],
    conflicts: [],
    diagnostics: [],
    resolutionCount: 0,
    mutationGuarantee: 'preview-only',
  };
}

export function alreadyMergedApplyMergeResult(input: {
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
}): VersionApplyMergeResult {
  return {
    status: 'alreadyMerged',
    base: input.base,
    ours: input.ours,
    theirs: input.theirs,
    commitRef: {
      id: input.ours,
      refName: input.targetRef,
      resolvedFrom: input.targetRef,
      refRevision: input.expectedTargetHead.revision,
    },
    changes: [],
    conflicts: [],
    diagnostics: [],
    resolutionCount: 0,
    mutationGuarantee: 'ref-not-mutated',
  };
}
