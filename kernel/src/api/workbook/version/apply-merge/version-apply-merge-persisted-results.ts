import type {
  VersionApplyMergeResult,
  VersionMergeResultId,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { MergeApplyIntentRecord } from '../../../../document/version-store/merge-apply-intent-store';
import type { VersionStoreProvider } from '../../../../document/version-store/provider';
import { blockedApplyMergeResult } from './version-apply-merge-persisted-diagnostics';
import { readCurrentTargetHead } from './version-apply-merge-persisted-lookup';

export async function resultFromTerminalIntent(
  provider: VersionStoreProvider,
  record: MergeApplyIntentRecord,
): Promise<VersionApplyMergeResult> {
  const resultId = publicResultId(record);
  if (record.terminal?.status === 'alreadyMerged') {
    const expectedCommitId = record.terminal.commitId ?? record.terminal.headAfter ?? record.ours;
    const stale = await resultIfTargetMoved(provider, record, resultId, expectedCommitId);
    if (stale) return stale;
    return alreadyMergedPersistedResult(record, resultId);
  }
  if (record.terminal?.status === 'fastForwarded' || record.terminal?.status === 'alreadyApplied') {
    const commitId = record.terminal.commitId ?? record.terminal.headAfter ?? record.theirs;
    const stale = await resultIfTargetMoved(provider, record, resultId, commitId);
    if (stale) return stale;
    return {
      ...persistedMetadata(record, resultId),
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
  return {
    ...persistedMetadata(record, resultId),
    status: 'staleTargetHead',
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    changes: [],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'ref-not-mutated',
  };
}

export async function resultIfTargetMoved(
  provider: VersionStoreProvider,
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId,
  expectedCommitId: WorkbookCommitId,
): Promise<VersionApplyMergeResult | null> {
  const current = await readCurrentTargetHead(provider, record);
  if (!current.ok) {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      current.diagnostics,
      'no-write-attempted',
    );
  }
  if (current.commitId === expectedCommitId) return null;
  return staleTargetHeadPersistedResult(record, resultId, current.commitId);
}

export function fastForwardedPersistedResult(
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId,
  commitRef: WorkbookCommitRef,
): VersionApplyMergeResult {
  return {
    ...persistedMetadata(record, resultId),
    status: 'fastForwarded',
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    commitRef,
    changes: [],
    conflicts: [],
    diagnostics: [],
    resolutionCount: 0,
    mutationGuarantee: 'ref-fast-forwarded',
  };
}

export function alreadyMergedPersistedResult(
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId,
): VersionApplyMergeResult {
  return {
    ...persistedMetadata(record, resultId),
    status: 'alreadyMerged',
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    commitRef: commitRefForIntent(record, record.ours),
    changes: [],
    conflicts: [],
    diagnostics: [],
    resolutionCount: 0,
    mutationGuarantee: 'ref-not-mutated',
  };
}

export function staleTargetHeadPersistedResult(
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId,
  currentHead: WorkbookCommitId,
): VersionApplyMergeResult {
  return {
    ...persistedMetadata(record, resultId),
    headAfter: currentHead,
    status: 'staleTargetHead',
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    changes: [],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'ref-not-mutated',
  };
}

export function persistedMetadata(record: MergeApplyIntentRecord, resultId: VersionMergeResultId) {
  return {
    resultId,
    resultDigest: record.resultDigest,
    resolutionSetDigest: record.resolutionSetDigest,
    resolvedAttemptDigest: record.resolvedAttemptDigest,
    targetRef: record.targetRef,
    headBefore: record.terminal?.headBefore ?? record.ours,
    ...(record.terminal?.headAfter ? { headAfter: record.terminal.headAfter } : {}),
  };
}

export function persistedPlan(record: MergeApplyIntentRecord, resultId: VersionMergeResultId) {
  return {
    ...persistedMetadata(record, resultId),
    expectedTargetHead: record.expectedTargetHead,
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    changes: [],
    resolutionCount: 0,
  };
}

export function commitRefForIntent(
  record: MergeApplyIntentRecord,
  commitId: WorkbookCommitId,
): WorkbookCommitRef {
  return { id: commitId, refName: record.targetRef, resolvedFrom: record.targetRef };
}

function publicResultId(record: MergeApplyIntentRecord): VersionMergeResultId {
  return `merge-result:${record.resolvedAttemptDigest.digest}` as VersionMergeResultId;
}
