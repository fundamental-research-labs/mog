import type {
  VersionCommitExpectedHead,
  VersionApplyMergeResult,
  VersionMainRefName,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type {
  MergeApplyIntentRecord,
  MergeApplyRefCasProof,
  MergeApplyIntentStore,
  MergeApplyIntentStoreDiagnostic,
} from '../../../../../document/version-store/merge-apply-intent-store';
import { computeMergeApplyRefCasProof } from '../../../../../document/version-store/merge-apply-intent-store';
import type { ObjectDigest } from '../../../../../document/version-store/object-digest';
import type { VersionGraphStore } from '../../../../../document/version-store/provider-graph-store';
import type { NormalizedPersistedApplyMergeInput } from '../version-apply-merge-persisted';

type PreparedMergeApplyArtifactIntentIdentity = {
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly resultDigest: ObjectDigest;
  readonly resolutionSetDigest: ObjectDigest;
  readonly resolvedAttemptDigest: ObjectDigest;
};

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
  readonly resolutionMismatchDiagnostic: (safeMessage: string) => VersionStoreDiagnostic;
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
  resolutionMismatchDiagnostic,
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

  const proofRead = await store.readRefCasProof({
    applyKind: 'mergeCommit',
    targetRef: record.targetRef,
    headBefore: record.ours,
    headAfter: current.commitId,
  });
  if (proofRead.status !== 'found') {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      intentStoreDiagnostics(proofRead.diagnostics),
      'ref-not-mutated',
    );
  }
  const proofDiagnostics = await validateMergeCommitRefCasProof(
    record,
    current.commitId,
    proofRead.proof,
    resolutionMismatchDiagnostic,
  );
  if (proofDiagnostics.length > 0) {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      proofDiagnostics,
      'ref-not-mutated',
    );
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
      refCasProof: proofRead.proof,
    },
  });
  if (completed.status !== 'completed') {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      intentStoreDiagnostics(completed.diagnostics),
      'ref-not-mutated',
    );
  }
  return resultFromTerminalArtifactIntent(graph, input, completed.record);
}

export function validatePreparedMergeApplyArtifactIntentRecord(
  record: MergeApplyIntentRecord,
  expected: PreparedMergeApplyArtifactIntentIdentity,
  resolutionMismatchDiagnostic: (safeMessage: string) => VersionStoreDiagnostic,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (record.intentId !== expected.intentId) {
    diagnostics.push(resolutionMismatchDiagnostic('persisted merge intent id does not match.'));
  }
  if (record.idempotencyKey !== expected.idempotencyKey) {
    diagnostics.push(
      resolutionMismatchDiagnostic('persisted merge idempotency key does not match.'),
    );
  }
  if (record.applyKind !== 'mergeCommit') {
    diagnostics.push(resolutionMismatchDiagnostic('persisted merge apply kind does not match.'));
  }
  if (
    record.base !== expected.base ||
    record.ours !== expected.ours ||
    record.theirs !== expected.theirs
  ) {
    diagnostics.push(resolutionMismatchDiagnostic('persisted merge commits do not match.'));
  }
  if (record.targetRef !== expected.targetRef) {
    diagnostics.push(resolutionMismatchDiagnostic('persisted merge targetRef does not match.'));
  }
  if (!expectedHeadsEqual(record.expectedTargetHead, expected.expectedTargetHead)) {
    diagnostics.push(
      resolutionMismatchDiagnostic('persisted merge expectedTargetHead does not match.'),
    );
  }
  if (!digestsEqual(record.resultDigest, expected.resultDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge resultDigest does not match the resolved artifact.',
      ),
    );
  }
  if (!digestsEqual(record.resolutionSetDigest, expected.resolutionSetDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge resolutionSetDigest does not match the resolved artifact.',
      ),
    );
  }
  if (!digestsEqual(record.resolvedAttemptDigest, expected.resolvedAttemptDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge resolvedAttemptDigest does not match the resolved artifact.',
      ),
    );
  }
  return diagnostics;
}

async function validateMergeCommitRefCasProof(
  record: MergeApplyIntentRecord,
  commitId: WorkbookCommitId,
  proof: MergeApplyRefCasProof,
  resolutionMismatchDiagnostic: (safeMessage: string) => VersionStoreDiagnostic,
): Promise<readonly VersionStoreDiagnostic[]> {
  const expected = await computeMergeApplyRefCasProof({
    applyKind: 'mergeCommit',
    targetRef: record.targetRef,
    headBefore: record.ours,
    headAfter: commitId,
  });
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (proof.applyKind !== 'mergeCommit') {
    diagnostics.push(
      resolutionMismatchDiagnostic('merge commit ref CAS proof apply kind does not match.'),
    );
  }
  if (!digestsEqual(proof.commitMetadataDigest, expected.commitMetadataDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic('merge commit ref CAS proof commit metadata does not match.'),
    );
  }
  if (!digestsEqual(proof.refUpdateMetadataDigest, expected.refUpdateMetadataDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic('merge commit ref CAS proof ref update does not match.'),
    );
  }
  if (!digestsEqual(proof.refLogEventDigest, expected.refLogEventDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic('merge commit ref CAS proof event log does not match.'),
    );
  }
  return diagnostics;
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

function expectedHeadsEqual(
  left: VersionCommitExpectedHead,
  right: VersionCommitExpectedHead,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
