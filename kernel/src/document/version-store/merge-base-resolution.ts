import type {
  VersionMergeInput,
  VersionStoreDiagnostic as PublicVersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { WorkbookCommit } from './commit-store';

export type VersionMergeBaseCommitRead = {
  readonly commit: WorkbookCommit;
  readonly closure: readonly WorkbookCommit[];
};

export type VersionMergeBaseResolution =
  | { readonly status: 'alreadyMerged' }
  | { readonly status: 'fastForward' }
  | { readonly status: 'divergent' }
  | {
      readonly status: 'blocked';
      readonly diagnostic: PublicVersionStoreDiagnostic;
    };

export type VersionComputedMergeBaseResolution =
  | { readonly status: 'alreadyMerged'; readonly base: WorkbookCommitId }
  | { readonly status: 'fastForward'; readonly base: WorkbookCommitId }
  | { readonly status: 'divergent'; readonly base: WorkbookCommitId }
  | {
      readonly status: 'blocked';
      readonly diagnostic: PublicVersionStoreDiagnostic;
    };

export function resolveVersionMergeBase(
  input: VersionMergeInput,
  ours: VersionMergeBaseCommitRead,
  theirs: VersionMergeBaseCommitRead,
): VersionMergeBaseResolution {
  const computed = computeVersionMergeBase(input.ours, input.theirs, ours, theirs);
  if (computed.status === 'alreadyMerged' || computed.status === 'fastForward') {
    return computed;
  }
  if (computed.status === 'blocked') return computed;
  if (computed.base !== input.base) {
    return {
      status: 'blocked',
      diagnostic: diagnostic(
        'VERSION_MERGE_BASE_MISMATCH',
        'Merge preview requires the requested base to match the lowest common ancestor.',
        {
          recoverability: 'unsupported',
          payload: { diagnosticCode: 'expectedBaseMismatch' },
        },
      ),
    };
  }

  return { status: 'divergent' };
}

export function computeVersionMergeBase(
  oursCommitId: WorkbookCommitId,
  theirsCommitId: WorkbookCommitId,
  ours: VersionMergeBaseCommitRead,
  theirs: VersionMergeBaseCommitRead,
): VersionComputedMergeBaseResolution {
  if (oursCommitId === theirsCommitId || commitClosureContains(ours, theirsCommitId)) {
    return { status: 'alreadyMerged', base: theirsCommitId };
  }
  if (commitClosureContains(theirs, oursCommitId)) {
    return { status: 'fastForward', base: oursCommitId };
  }

  const commitsById = new Map<WorkbookCommitId, WorkbookCommit>();
  for (const commit of [...ours.closure, ...theirs.closure]) {
    commitsById.set(commit.id, commit);
  }

  const oursClosureIds = new Set(ours.closure.map((commit) => commit.id));
  const commonAncestorIds = theirs.closure
    .map((commit) => commit.id)
    .filter((commitId) => oursClosureIds.has(commitId));

  if (commonAncestorIds.length === 0) {
    return {
      status: 'blocked',
      diagnostic: diagnostic(
        'VERSION_MERGE_UNRELATED_HISTORIES',
        'Merge preview requires commits with a common ancestor.',
        { recoverability: 'unsupported', payload: { diagnosticCode: 'unrelatedHistories' } },
      ),
    };
  }

  const lowestCommonAncestorIds = commonAncestorIds.filter(
    (candidateId) =>
      !commonAncestorIds.some(
        (otherId) => otherId !== candidateId && isAncestorCommit(candidateId, otherId, commitsById),
      ),
  );

  if (lowestCommonAncestorIds.length > 1) {
    return {
      status: 'blocked',
      diagnostic: diagnostic(
        'VERSION_MERGE_BASE_AMBIGUOUS',
        'Merge preview requires an unambiguous merge base.',
        {
          recoverability: 'unsupported',
          payload: {
            diagnosticCode: 'mergeBaseAmbiguous',
            lowestCommonAncestorCount: lowestCommonAncestorIds.length,
          },
        },
      ),
    };
  }

  return { status: 'divergent', base: lowestCommonAncestorIds[0] };
}

function commitClosureContains(
  read: VersionMergeBaseCommitRead,
  commitId: WorkbookCommitId,
): boolean {
  return read.closure.some((candidate) => candidate.id === commitId);
}

function isAncestorCommit(
  ancestorId: WorkbookCommitId,
  descendantId: WorkbookCommitId,
  commitsById: ReadonlyMap<WorkbookCommitId, WorkbookCommit>,
): boolean {
  const pending = [descendantId];
  const seen = new Set<WorkbookCommitId>();

  while (pending.length > 0) {
    const currentId = pending.pop();
    if (!currentId || seen.has(currentId)) continue;
    seen.add(currentId);

    const current = commitsById.get(currentId);
    if (!current) continue;
    for (const parentId of current.payload.parentCommitIds) {
      if (parentId === ancestorId) return true;
      pending.push(parentId);
    }
  }

  return false;
}

function diagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: PublicVersionStoreDiagnostic['severity'];
    readonly recoverability?: PublicVersionStoreDiagnostic['recoverability'];
    readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
  } = {},
): PublicVersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId:
      `version.merge.${issueCode}` as PublicVersionStoreDiagnostic['messageTemplateId'],
    safeMessage,
    ...(options.payload ? { payload: { operation: 'merge', ...options.payload } } : {}),
    redacted: true,
  };
}

function recoverabilityForIssue(issueCode: string): PublicVersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_MERGE_BASE_AMBIGUOUS':
    case 'VERSION_MERGE_BASE_MISMATCH':
    case 'VERSION_MERGE_UNRELATED_HISTORIES':
      return 'unsupported';
    default:
      return 'none';
  }
}
