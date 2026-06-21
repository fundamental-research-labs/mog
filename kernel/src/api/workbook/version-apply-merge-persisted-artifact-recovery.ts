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
import type { VersionGraphStore } from '../../document/version-store/provider-graph-store';
import type { NormalizedPersistedApplyMergeInput } from './version-apply-merge-persisted';

type TargetHeadReadResult =
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

type CommitParentReadResult =
  | { readonly ok: true; readonly parents: readonly WorkbookCommitId[] }
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
  if (input.resolutions.length > 0) return null;

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
    return { ok: true, parents: read.commit.payload.parentCommitIds };
  } catch {
    return { ok: false, diagnostics: [diagnostics.providerErrorDiagnostic()] };
  }
}
