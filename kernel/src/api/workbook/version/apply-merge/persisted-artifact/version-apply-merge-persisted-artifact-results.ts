import type {
  VersionApplyMergeResult,
  VersionMainRefName,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { MergeApplyIntentRecord } from '../../../../../document/version-store/merge-apply-intent-store';
import type { MergePreviewArtifactPayload } from '../../../../../document/version-store/merge-attempt-artifacts';
import type { VersionGraphStore } from '../../../../../document/version-store/provider-graph-store';
import type {
  NormalizedPersistedApplyMergeInput,
  NormalizedPersistedApplyMergeOptions,
} from '../version-apply-merge-persisted';
import {
  validateApplyMergeTargetRefCasProofForGraph,
  type ApplyMergeTargetRefCasValidationResult,
} from '../target-ref/version-apply-merge-target-ref';
import {
  blockedApplyMergeResult,
  mapProviderDiagnostics,
  providerErrorDiagnostic,
  resolutionMismatchDiagnostic,
} from './version-apply-merge-persisted-artifact-diagnostics';

type TargetRefCasFailure = Extract<ApplyMergeTargetRefCasValidationResult, { readonly ok: false }>;

export function replayPreviewArtifact(
  input: NormalizedPersistedApplyMergeInput,
  payload: MergePreviewArtifactPayload,
): VersionApplyMergeResult {
  if (payload.status === 'clean') {
    return {
      ...previewArtifactMetadata(input),
      status: 'planned',
      base: payload.base,
      ours: payload.ours,
      theirs: payload.theirs,
      changes: payload.changes,
      conflicts: [],
      diagnostics: [],
      resolutionCount: 0,
      mutationGuarantee: 'preview-only',
    };
  }
  if (payload.status === 'conflicted') {
    return {
      ...previewArtifactMetadata(input),
      status: 'conflicted',
      base: payload.base,
      ours: payload.ours,
      theirs: payload.theirs,
      changes: payload.changes,
      conflicts: payload.conflicts,
      diagnostics: [],
      requiredResolutionCount: payload.conflicts.length,
      mutationGuarantee: 'preview-only',
    };
  }
  return blockedApplyMergeResult(payload.base, payload.ours, payload.theirs, [
    resolutionMismatchDiagnostic(
      'persisted merge preview artifact is not a review-only merge result.',
    ),
  ]);
}

export async function staleTargetHeadBeforeStaging(
  graph: VersionGraphStore,
  input: NormalizedPersistedApplyMergeInput,
  payload: MergePreviewArtifactPayload,
  options: Extract<NormalizedPersistedApplyMergeOptions, { readonly mode: 'apply' }>,
): Promise<VersionApplyMergeResult | null> {
  const cas = await validateApplyMergeTargetRefCasProofForGraph(graph, {
    targetRef: options.targetRef,
    expectedTargetHead: options.expectedTargetHead,
  });
  if (cas.ok) return null;
  return resultFromPreviewArtifactTargetRefCasFailure(graph, input, payload, options, cas);
}

export async function staleTargetHeadBeforeMergeCommitWrite(
  graph: VersionGraphStore,
  input: NormalizedPersistedApplyMergeInput,
  record: MergeApplyIntentRecord,
): Promise<VersionApplyMergeResult | null> {
  const cas = await validateApplyMergeTargetRefCasProofForGraph(graph, {
    targetRef: record.targetRef,
    expectedTargetHead: record.expectedTargetHead,
  });
  if (cas.ok) return null;
  return resultFromArtifactIntentTargetRefCasFailure(graph, input, record, cas);
}

export async function resultFromTerminalArtifactIntent(
  graph: VersionGraphStore,
  input: NormalizedPersistedApplyMergeInput,
  record: MergeApplyIntentRecord,
): Promise<VersionApplyMergeResult> {
  const commitId = record.terminal?.commitId ?? record.terminal?.headAfter;
  if (!commitId) return staleTargetHeadArtifactResult(input, record, record.ours);

  const current = await readCurrentTargetHead(graph, record.targetRef);
  if (!current.ok) {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, current.diagnostics);
  }
  if (current.commitId !== commitId) {
    return staleTargetHeadArtifactResult(input, record, current.commitId);
  }

  return {
    ...artifactIntentMetadata(input, record, commitId),
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

export async function readCurrentTargetHead(
  graph: VersionGraphStore,
  targetRef: VersionMainRefName | VersionRefName,
): Promise<
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  try {
    const read = await graph.readRef(targetRef);
    if (read.status !== 'success' || !('commitId' in read.ref)) {
      return { ok: false, diagnostics: mapProviderDiagnostics(read.diagnostics) };
    }
    return { ok: true, commitId: read.ref.commitId };
  } catch {
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }
}

export function staleTargetHeadArtifactResult(
  input: NormalizedPersistedApplyMergeInput,
  record: MergeApplyIntentRecord,
  currentHead: WorkbookCommitId,
  diagnostics: readonly VersionStoreDiagnostic[] = [],
): VersionApplyMergeResult {
  return {
    ...artifactIntentMetadata(input, record),
    headAfter: currentHead,
    status: 'staleTargetHead',
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee: 'ref-not-mutated',
  };
}

export function applyArtifactMetadata(
  result: VersionApplyMergeResult,
  input: NormalizedPersistedApplyMergeInput,
  record: MergeApplyIntentRecord,
  headAfter: WorkbookCommitId,
): VersionApplyMergeResult {
  return {
    ...result,
    ...artifactIntentMetadata(input, record, headAfter),
  };
}

function previewArtifactMetadata(input: NormalizedPersistedApplyMergeInput) {
  return {
    resultId: input.resultId,
    previewArtifactDigest: input.resultDigest,
    resultDigest: input.resultDigest,
  };
}

function staleTargetHeadPreviewArtifactResult(
  input: NormalizedPersistedApplyMergeInput,
  payload: MergePreviewArtifactPayload,
  options: Extract<NormalizedPersistedApplyMergeOptions, { readonly mode: 'apply' }>,
  currentHead: WorkbookCommitId,
  diagnostics: readonly VersionStoreDiagnostic[] = [],
): VersionApplyMergeResult {
  return {
    ...previewArtifactMetadata(input),
    targetRef: options.targetRef,
    headBefore: payload.ours,
    headAfter: currentHead,
    status: 'staleTargetHead',
    base: payload.base,
    ours: payload.ours,
    theirs: payload.theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee: 'ref-not-mutated',
  };
}

async function resultFromPreviewArtifactTargetRefCasFailure(
  graph: VersionGraphStore,
  input: NormalizedPersistedApplyMergeInput,
  payload: MergePreviewArtifactPayload,
  options: Extract<NormalizedPersistedApplyMergeOptions, { readonly mode: 'apply' }>,
  failure: TargetRefCasFailure,
): Promise<VersionApplyMergeResult> {
  if (failure.kind === 'blocked') {
    return blockedApplyMergeResult(payload.base, payload.ours, payload.theirs, failure.diagnostics);
  }

  const current = await readCurrentTargetHead(graph, options.targetRef);
  if (!current.ok) {
    return blockedApplyMergeResult(payload.base, payload.ours, payload.theirs, current.diagnostics);
  }
  return staleTargetHeadPreviewArtifactResult(
    input,
    payload,
    options,
    current.commitId,
    failure.diagnostics,
  );
}

async function resultFromArtifactIntentTargetRefCasFailure(
  graph: VersionGraphStore,
  input: NormalizedPersistedApplyMergeInput,
  record: MergeApplyIntentRecord,
  failure: TargetRefCasFailure,
): Promise<VersionApplyMergeResult> {
  if (failure.kind === 'blocked') {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, failure.diagnostics);
  }

  const current = await readCurrentTargetHead(graph, record.targetRef);
  if (!current.ok) {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, current.diagnostics);
  }
  return staleTargetHeadArtifactResult(input, record, current.commitId, failure.diagnostics);
}

function artifactIntentMetadata(
  input: NormalizedPersistedApplyMergeInput,
  record: MergeApplyIntentRecord,
  headAfter?: WorkbookCommitId,
) {
  return {
    resultId: input.resultId,
    previewArtifactDigest: input.resultDigest,
    resultDigest: input.resultDigest,
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
