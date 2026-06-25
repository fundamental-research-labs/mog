import type {
  VersionApplyMergeResult,
  VersionMergeResultId,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { MergeApplyIntentRecord } from '../../../../document/version-store/merge-apply-intent-store';
import type { VersionGraphStore } from '../../../../document/version-store/provider-graph-store';
import {
  recoveryOperationIdentityMismatchDiagnostic,
  staleTargetHeadDiagnostic,
} from './version-apply-merge-recovery-diagnostics';

type TargetHeadReadResult =
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export async function resultFromTerminalIntent(
  graph: VersionGraphStore,
  record: MergeApplyIntentRecord,
  readCurrentTargetHead: (
    graph: VersionGraphStore,
    targetRef: MergeApplyIntentRecord['targetRef'],
  ) => Promise<TargetHeadReadResult>,
): Promise<VersionApplyMergeResult> {
  const commitId = record.terminal?.commitId ?? record.terminal?.headAfter;
  if (!commitId) {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, [
      recoveryOperationIdentityMismatchDiagnostic(
        'Recovery terminal commit identity is incomplete.',
      ),
    ]);
  }
  const current = await readCurrentTargetHead(graph, record.targetRef);
  if (!current.ok) {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, current.diagnostics);
  }
  return current.commitId === commitId
    ? alreadyAppliedResult(record, commitId)
    : staleTargetHeadBlockedResult(record);
}

export function alreadyAppliedResult(
  record: MergeApplyIntentRecord,
  commitId: WorkbookCommitId,
): VersionApplyMergeResult {
  return {
    ...recoveryMetadata(record, commitId),
    status: 'alreadyApplied',
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    commitRef: commitRefForIntent(record, commitId),
    changes: [],
    conflicts: [],
    diagnostics: [],
    resolutionCount: 0,
    mutationGuarantee: 'ref-not-mutated',
  };
}

export function staleTargetHeadBlockedResult(
  record: MergeApplyIntentRecord,
): VersionApplyMergeResult {
  return blockedApplyMergeResult(
    record.base,
    record.ours,
    record.theirs,
    [staleTargetHeadDiagnostic()],
    'ref-not-mutated',
  );
}

export function blockedApplyMergeResult(
  base: WorkbookCommitId | null,
  ours: WorkbookCommitId | null,
  theirs: WorkbookCommitId | null,
  diagnostics: readonly VersionStoreDiagnostic[],
  mutationGuarantee: VersionApplyMergeResult['mutationGuarantee'] = 'no-write-attempted',
): VersionApplyMergeResult {
  return {
    status: 'blocked',
    base,
    ours,
    theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee,
  };
}

export function publicResultId(record: MergeApplyIntentRecord): VersionMergeResultId {
  return `merge-result:${record.resolvedAttemptDigest.digest}` as VersionMergeResultId;
}

function recoveryMetadata(record: MergeApplyIntentRecord, headAfter?: WorkbookCommitId) {
  return {
    resultId: publicResultId(record),
    resultDigest: record.resultDigest,
    resolutionSetDigest: record.resolutionSetDigest,
    resolvedAttemptDigest: record.resolvedAttemptDigest,
    targetRef: record.targetRef,
    headBefore: record.terminal?.headBefore ?? record.ours,
    ...(headAfter ? { headAfter } : {}),
  };
}

function commitRefForIntent(
  record: MergeApplyIntentRecord,
  commitId: WorkbookCommitId,
): WorkbookCommitRef {
  return {
    id: commitId,
    refName: record.targetRef,
    resolvedFrom: record.targetRef,
  };
}
