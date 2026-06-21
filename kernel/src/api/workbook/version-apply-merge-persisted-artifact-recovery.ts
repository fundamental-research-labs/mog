import type {
  VersionApplyMergeResult,
  VersionMainRefName,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type {
  MergeApplyIntentRecord,
  MergeApplyIntentStore,
  MergeApplyIntentStoreDiagnostic,
} from '../../document/version-store/merge-apply-intent-store';
import type { ObjectDigest } from '../../document/version-store/object-digest';
import type { VersionGraphStore } from '../../document/version-store/provider-graph-store';
import type { NormalizedPersistedApplyMergeInput } from './version-apply-merge-persisted';

type TargetHeadReadResult =
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

type CommitParentReadResult =
  | {
      readonly ok: true;
      readonly parents: readonly WorkbookCommitId[];
      readonly resolvedMergeAttemptDigest?: ObjectDigest;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

type RecoverStagedMergeCommitIfAlreadyAppliedInput = {
  readonly graph: VersionGraphStore;
  readonly store: MergeApplyIntentStore;
  readonly input: NormalizedPersistedApplyMergeInput;
  readonly record: MergeApplyIntentRecord;
  readonly readCurrentTargetHead: (
    graph: VersionGraphStore,
    targetRef: VersionMainRefName | VersionRefName,
  ) => Promise<TargetHeadReadResult>;
  readonly resultFromTerminalArtifactIntent: (
    graph: VersionGraphStore,
    input: NormalizedPersistedApplyMergeInput,
    record: MergeApplyIntentRecord,
  ) => Promise<VersionApplyMergeResult>;
  readonly staleTargetHeadArtifactResult: (
    input: NormalizedPersistedApplyMergeInput,
    record: MergeApplyIntentRecord,
    currentHead: WorkbookCommitId,
  ) => VersionApplyMergeResult;
  readonly blockedApplyMergeResult: (
    base: WorkbookCommitId | null,
    ours: WorkbookCommitId | null,
    theirs: WorkbookCommitId | null,
    diagnostics: readonly VersionStoreDiagnostic[],
    mutationGuarantee?: VersionApplyMergeResult['mutationGuarantee'],
  ) => VersionApplyMergeResult;
  readonly mapProviderDiagnostics: (
    diagnostics: readonly unknown[],
  ) => readonly VersionStoreDiagnostic[];
  readonly providerErrorDiagnostic: () => VersionStoreDiagnostic;
  readonly intentStoreDiagnostics: (
    diagnostics: readonly MergeApplyIntentStoreDiagnostic[],
  ) => readonly VersionStoreDiagnostic[];
};

export async function recoverStagedMergeCommitIfAlreadyApplied({
  graph,
  store,
  input,
  record,
  readCurrentTargetHead,
  resultFromTerminalArtifactIntent,
  staleTargetHeadArtifactResult,
  blockedApplyMergeResult,
  mapProviderDiagnostics,
  providerErrorDiagnostic,
  intentStoreDiagnostics,
}: RecoverStagedMergeCommitIfAlreadyAppliedInput): Promise<VersionApplyMergeResult | null> {
  if (record.applyKind !== 'mergeCommit' || record.terminal) return null;

  const current = await readCurrentTargetHead(graph, record.targetRef);
  if (!current.ok) {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, current.diagnostics);
  }
  if (current.commitId === record.ours) return null;

  const committed = await readCommitParentIds(graph, current.commitId, {
    mapProviderDiagnostics,
    providerErrorDiagnostic,
  });
  if (!committed.ok) {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, committed.diagnostics);
  }
  if (
    committed.parents.length !== 2 ||
    committed.parents[0] !== record.ours ||
    committed.parents[1] !== record.theirs
  ) {
    return staleTargetHeadArtifactResult(input, record, current.commitId);
  }
  if (
    !digestsEqual(committed.resolvedMergeAttemptDigest, record.resolvedAttemptDigest) &&
    (input.resolutions.length > 0 || committed.resolvedMergeAttemptDigest !== undefined)
  ) {
    return staleTargetHeadArtifactResult(input, record, current.commitId);
  }

  const completed = await store.completeIntent({
    intentId: record.intentId,
    resolvedAttemptDigest: record.resolvedAttemptDigest,
    completedAt: new Date().toISOString(),
    terminal: {
      status: 'applied',
      headBefore: record.ours,
      headAfter: current.commitId,
      commitId: current.commitId,
    },
  });
  if (completed.status !== 'completed') {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      intentStoreDiagnostics(completed.diagnostics),
      'unknown-after-crash',
    );
  }
  return resultFromTerminalArtifactIntent(graph, input, completed.record);
}

export async function validateAppliedMergeCommitIdentity(
  graph: VersionGraphStore,
  record: MergeApplyIntentRecord,
  commitId: WorkbookCommitId,
  diagnostics: {
    readonly mapProviderDiagnostics: (
      diagnostics: readonly unknown[],
    ) => readonly VersionStoreDiagnostic[];
    readonly providerErrorDiagnostic: () => VersionStoreDiagnostic;
    readonly resolutionMismatchDiagnostic: (safeMessage: string) => VersionStoreDiagnostic;
  },
): Promise<readonly VersionStoreDiagnostic[]> {
  try {
    const read = await graph.readCommit(commitId);
    if (read.status !== 'success') return diagnostics.mapProviderDiagnostics(read.diagnostics);
    const payload = read.commit.payload;
    if (
      payload.parentCommitIds.length !== 2 ||
      payload.parentCommitIds[0] !== record.ours ||
      payload.parentCommitIds[1] !== record.theirs
    ) {
      return [
        diagnostics.resolutionMismatchDiagnostic(
          'applied merge commit parents do not match the merge intent.',
        ),
      ];
    }
    if (
      !payload.resolvedMergeAttemptDigest ||
      !digestsEqual(payload.resolvedMergeAttemptDigest, record.resolvedAttemptDigest)
    ) {
      return [
        diagnostics.resolutionMismatchDiagnostic(
          'applied merge commit is not bound to the resolved merge attempt.',
        ),
      ];
    }
    return [];
  } catch {
    return [diagnostics.providerErrorDiagnostic()];
  }
}

async function readCommitParentIds(
  graph: VersionGraphStore,
  commitId: WorkbookCommitId,
  diagnostics: {
    readonly mapProviderDiagnostics: (
      diagnostics: readonly unknown[],
    ) => readonly VersionStoreDiagnostic[];
    readonly providerErrorDiagnostic: () => VersionStoreDiagnostic;
  },
): Promise<CommitParentReadResult> {
  try {
    const read = await graph.readCommit(commitId);
    if (read.status !== 'success') {
      return { ok: false, diagnostics: diagnostics.mapProviderDiagnostics(read.diagnostics) };
    }
    return {
      ok: true,
      parents: read.commit.payload.parentCommitIds,
      ...(read.commit.payload.resolvedMergeAttemptDigest === undefined
        ? {}
        : { resolvedMergeAttemptDigest: read.commit.payload.resolvedMergeAttemptDigest }),
    };
  } catch {
    return { ok: false, diagnostics: [diagnostics.providerErrorDiagnostic()] };
  }
}

function digestsEqual(left: ObjectDigest | undefined, right: ObjectDigest): boolean {
  return left?.algorithm === right.algorithm && left.digest === right.digest;
}
