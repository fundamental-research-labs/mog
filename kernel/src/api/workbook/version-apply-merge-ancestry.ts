import type {
  VersionApplyMergeResult,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionRefName,
  VersionStoreDiagnostic,
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
  if (input.expectedTargetHead.commitId !== input.ours) {
    return blockedAncestryApplyMergeResult(input.base, input.ours, input.theirs, [
      ancestryMismatchDiagnostic(),
    ]);
  }
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

function blockedAncestryApplyMergeResult(
  base: WorkbookCommitId,
  ours: WorkbookCommitId,
  theirs: WorkbookCommitId,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionApplyMergeResult {
  return {
    status: 'blocked',
    base,
    ours,
    theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee: 'no-write-attempted',
  };
}

function ancestryMismatchDiagnostic(): VersionStoreDiagnostic {
  return {
    issueCode: 'VERSION_REF_CONFLICT',
    severity: 'error',
    recoverability: 'retry',
    messageTemplateId: 'version.applyMerge.VERSION_REF_CONFLICT',
    safeMessage: 'applyMerge expectedTargetHead must match the already-merged target commit.',
    payload: { operation: 'applyMerge', reason: 'expectedTargetHeadMismatch' },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}
