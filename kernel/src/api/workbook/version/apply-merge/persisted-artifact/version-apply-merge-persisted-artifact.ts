import type { VersionApplyMergeResult, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../../context';
import {
  idempotencyKeyForResolvedAttempt,
  intentIdForResolvedAttemptDigest,
  type MergeApplyIntentRecord,
  type MergeApplyIntentStore,
} from '../../../../../document/version-store/merge-apply-intent-store';
import {
  createMergeResolutionSetArtifactRecord,
  type MergePreviewArtifactPayload,
  type MergeResolutionSetArtifactRecord,
  type ResolvedMergeAttemptArtifactRecord,
} from '../../../../../document/version-store/merge-attempt-artifacts';
import type { ObjectDigest as InternalObjectDigest } from '../../../../../document/version-store/object-digest';
import type { VersionGraphNamespace } from '../../../../../document/version-store/object-store';
import type { VersionGraphStore } from '../../../../../document/version-store/provider-graph-store';
import {
  isApplyMergeWriteSuccessResult,
  mapApplyMergeWriteResult,
} from '../write-result/version-apply-merge-write-result';
import {
  applyMergeServiceUnavailableDiagnostic,
  blockedApplyMergeResult,
  intentStoreDiagnostics,
  mapProviderDiagnostics,
  providerErrorDiagnostic,
  publicDiagnostic,
  resolutionMismatchDiagnostic,
} from './version-apply-merge-persisted-artifact-diagnostics';
import { materializableMergePlanDiagnostics } from '../../merge/version-merge-materializer-support';
import type {
  NormalizedPersistedApplyMergeInput,
  NormalizedPersistedApplyMergeOptions,
} from '../version-apply-merge-persisted';
import {
  recoverStagedMergeCommitIfAlreadyApplied,
  validatePreparedMergeApplyArtifactIntentRecord,
  validateAppliedMergeCommitIdentity,
} from './version-apply-merge-persisted-artifact-recovery';
import { createResolvedMergeAttemptArtifactRecordForResolutionSet } from '../../merge-review/version-merge-review-saved-resolution-artifacts';
import {
  getAttachedVersionApplyMergeService,
  openPersistedMergeGraph,
} from './version-apply-merge-persisted-artifact-binding';
import {
  readPreviewArtifact,
  toInternalSha256Digest,
  validatePersistedMergePreviewSealedPayloadRefs,
} from './version-apply-merge-persisted-artifact-sealed-payload';
import {
  planPreviewArtifactApply,
  validatePreviewArtifactForApply,
  validatePreviewDigestInput,
  validateResolvedAttemptDigests,
} from './version-apply-merge-persisted-artifact-validation';
import {
  applyArtifactMetadata,
  readCurrentTargetHead,
  replayPreviewArtifact,
  resultFromTerminalArtifactIntent,
  staleTargetHeadArtifactResult,
  staleTargetHeadBeforeMergeCommitWrite,
  staleTargetHeadBeforeStaging,
} from './version-apply-merge-persisted-artifact-results';

export function isPersistedMergePreviewArtifactInput(
  input: NormalizedPersistedApplyMergeInput,
): boolean {
  return (
    input.resultId === `merge-result:${(input.previewArtifactDigest ?? input.resultDigest).digest}`
  );
}

export async function applyPersistedMergePreviewArtifact(
  ctx: DocumentContext,
  input: NormalizedPersistedApplyMergeInput,
  options: NormalizedPersistedApplyMergeOptions,
): Promise<VersionApplyMergeResult> {
  const digestDiagnostics = validatePreviewDigestInput(input);
  if (digestDiagnostics.length > 0) {
    return blockedApplyMergeResult(null, null, null, digestDiagnostics);
  }

  const opened = await openPersistedMergeGraph(ctx);
  if (!opened.ok) {
    return blockedApplyMergeResult(null, null, null, opened.diagnostics);
  }

  const artifact = await readPreviewArtifact(opened.graph, input.resultDigest);
  if (!artifact.ok) {
    return blockedApplyMergeResult(null, null, null, artifact.diagnostics);
  }

  if (options.mode === 'preview') {
    if (input.resolutions.length > 0) {
      return blockedApplyMergeResult(
        artifact.payload.base,
        artifact.payload.ours,
        artifact.payload.theirs,
        [resolutionMismatchDiagnostic('preview replay does not accept conflict resolutions.')],
      );
    }
    return replayPreviewArtifact(input, artifact.payload);
  }

  const resolutionPlan = planPreviewArtifactApply(artifact.payload, input.resolutions);
  if (!resolutionPlan.ok) {
    return blockedApplyMergeResult(
      artifact.payload.base,
      artifact.payload.ours,
      artifact.payload.theirs,
      resolutionPlan.diagnostics,
    );
  }

  const supportDiagnostics = materializableMergePlanDiagnostics(
    { changes: [...artifact.payload.changes, ...resolutionPlan.changes] },
    'applyMerge',
  );
  if (supportDiagnostics.length > 0) {
    return blockedApplyMergeResult(
      artifact.payload.base,
      artifact.payload.ours,
      artifact.payload.theirs,
      supportDiagnostics,
    );
  }

  const validationDiagnostics = validatePreviewArtifactForApply(artifact.payload, options);
  if (validationDiagnostics.length > 0) {
    return blockedApplyMergeResult(
      artifact.payload.base,
      artifact.payload.ours,
      artifact.payload.theirs,
      validationDiagnostics,
    );
  }

  const sealedPayloadDiagnostics = await validatePersistedMergePreviewSealedPayloadRefs({
    graph: opened.graph,
    resultId: input.resultId,
    resultDigest: input.resultDigest,
    targetRef: options.targetRef,
    expectedTargetHead: options.expectedTargetHead,
    conflicts: artifact.payload.conflicts,
    resolutions: input.resolutions,
  });
  if (sealedPayloadDiagnostics.length > 0) {
    return blockedApplyMergeResult(
      artifact.payload.base,
      artifact.payload.ours,
      artifact.payload.theirs,
      sealedPayloadDiagnostics,
    );
  }

  const prepared = await prepareResolvedAttempt(opened, artifact.payload, input, options);
  if (!prepared.ok) {
    if ('result' in prepared) return prepared.result;
    return blockedApplyMergeResult(
      artifact.payload.base,
      artifact.payload.ours,
      artifact.payload.theirs,
      prepared.diagnostics,
    );
  }
  if (prepared.intent.terminal) {
    return resultFromTerminalArtifactIntent(opened.graph, input, prepared.intent);
  }
  const recovered = await recoverStagedMergeCommitIfAlreadyApplied({
    graph: opened.graph,
    store: prepared.store,
    input,
    record: prepared.intent,
    readCurrentTargetHead,
    resultFromTerminalArtifactIntent,
    staleTargetHeadArtifactResult,
    blockedApplyMergeResult,
    mapProviderDiagnostics,
    providerErrorDiagnostic,
    intentStoreDiagnostics,
    resolutionMismatchDiagnostic,
  });
  if (recovered) return recovered;

  const staleBeforeWrite = await staleTargetHeadBeforeMergeCommitWrite(
    opened.graph,
    input,
    prepared.intent,
  );
  if (staleBeforeWrite) return staleBeforeWrite;

  const service = getAttachedVersionApplyMergeService(ctx);
  if (!service?.mergeCommit) {
    return blockedApplyMergeResult(
      artifact.payload.base,
      artifact.payload.ours,
      artifact.payload.theirs,
      [applyMergeServiceUnavailableDiagnostic()],
    );
  }

  const writePlan = {
    base: artifact.payload.base,
    ours: artifact.payload.ours,
    theirs: artifact.payload.theirs,
    changes: [...artifact.payload.changes, ...resolutionPlan.changes],
    resolutionCount: input.resolutions.length,
    targetRef: options.targetRef,
    expectedTargetHead: options.expectedTargetHead,
    resultId: input.resultId,
    previewArtifactDigest: input.previewArtifactDigest ?? input.resultDigest,
    resultDigest: input.resultDigest,
    resolutionSetDigest: prepared.intent.resolutionSetDigest,
    resolvedAttemptDigest: prepared.intent.resolvedAttemptDigest,
  };

  try {
    const raw = await service.mergeCommit({
      ...writePlan,
      targetRef: options.targetRef,
      expectedTargetHead: options.expectedTargetHead,
      resolvedMergeAttemptDigest: prepared.intent.resolvedAttemptDigest,
    });
    const mapped = mapApplyMergeWriteResult(raw, writePlan, 'merge-commit-created');
    if (!isApplyMergeWriteSuccessResult(mapped)) return mapped;
    if (!('commitRef' in mapped)) return mapped;
    const identityDiagnostics = await validateAppliedMergeCommitIdentity(
      opened.graph,
      prepared.intent,
      mapped.commitRef.id,
      {
        mapProviderDiagnostics,
        providerErrorDiagnostic,
        resolutionMismatchDiagnostic,
      },
    );
    if (identityDiagnostics.length > 0) {
      return applyArtifactMetadata(
        blockedApplyMergeResult(
          artifact.payload.base,
          artifact.payload.ours,
          artifact.payload.theirs,
          identityDiagnostics,
          'unknown-after-crash',
        ),
        input,
        prepared.intent,
        mapped.commitRef.id,
      );
    }
    const completed = await prepared.store.completeIntent({
      intentId: prepared.intent.intentId,
      resolvedAttemptDigest: prepared.intent.resolvedAttemptDigest,
      completedAt: new Date().toISOString(),
      terminal: {
        status: 'applied',
        headBefore: artifact.payload.ours,
        headAfter: mapped.commitRef.id,
        commitId: mapped.commitRef.id,
      },
    });
    if (completed.status !== 'completed') {
      return applyArtifactMetadata(
        blockedApplyMergeResult(
          artifact.payload.base,
          artifact.payload.ours,
          artifact.payload.theirs,
          intentStoreDiagnostics(completed.diagnostics),
          'unknown-after-crash',
        ),
        input,
        prepared.intent,
        mapped.commitRef.id,
      );
    }
    return applyArtifactMetadata(mapped, input, completed.record, mapped.commitRef.id);
  } catch {
    return blockedApplyMergeResult(
      artifact.payload.base,
      artifact.payload.ours,
      artifact.payload.theirs,
      [providerErrorDiagnostic()],
    );
  }
}

async function prepareResolvedAttempt(
  opened: {
    readonly namespace: VersionGraphNamespace;
    readonly graph: VersionGraphStore;
    readonly intentStore: MergeApplyIntentStore | null;
  },
  payload: MergePreviewArtifactPayload,
  input: NormalizedPersistedApplyMergeInput,
  options: Extract<NormalizedPersistedApplyMergeOptions, { readonly mode: 'apply' }>,
): Promise<
  | {
      readonly ok: true;
      readonly store: MergeApplyIntentStore;
      readonly intent: MergeApplyIntentRecord;
    }
  | { readonly ok: false; readonly result: VersionApplyMergeResult }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  if (!opened.intentStore) {
    return {
      ok: false,
      diagnostics: [
        publicDiagnostic(
          'VERSION_STORE_UNAVAILABLE',
          'No merge apply intent store is attached for persisted applyMerge.',
          { recoverability: 'unsupported' },
        ),
      ],
    };
  }

  const resultDigest = toInternalSha256Digest(input.resultDigest);
  if (!resultDigest) {
    return {
      ok: false,
      diagnostics: [
        resolutionMismatchDiagnostic('persisted merge resultDigest is not a merge-preview digest.'),
      ],
    };
  }

  const artifacts = await prepareResolvedAttemptArtifacts(
    opened.namespace,
    input,
    options,
    resultDigest,
  );
  if (!artifacts.ok) return { ok: false, diagnostics: artifacts.diagnostics };

  const intentId = intentIdForResolvedAttemptDigest(artifacts.resolvedAttempt.digest);
  const idempotencyKey = idempotencyKeyForResolvedAttempt({
    resolvedAttemptDigest: artifacts.resolvedAttempt.digest,
    targetRef: options.targetRef,
    expectedTargetHead: options.expectedTargetHead,
  });
  const existing = await opened.intentStore.readByIdempotencyKey(idempotencyKey);
  if (existing.status === 'found') {
    const existingDiagnostics = validatePreparedMergeApplyArtifactIntentRecord(
      existing.record,
      {
        intentId,
        idempotencyKey,
        base: payload.base,
        ours: payload.ours,
        theirs: payload.theirs,
        targetRef: options.targetRef,
        expectedTargetHead: options.expectedTargetHead,
        resultDigest,
        resolutionSetDigest: artifacts.resolutionSet.digest,
        resolvedAttemptDigest: artifacts.resolvedAttempt.digest,
      },
      resolutionMismatchDiagnostic,
    );
    if (existingDiagnostics.length > 0) {
      return { ok: false, diagnostics: existingDiagnostics };
    }
    return { ok: true, store: opened.intentStore, intent: existing.record };
  }
  if (existing.status === 'failed') {
    return { ok: false, diagnostics: intentStoreDiagnostics(existing.diagnostics) };
  }

  const staleBeforeStaging = await staleTargetHeadBeforeStaging(
    opened.graph,
    input,
    payload,
    options,
  );
  if (staleBeforeStaging) return { ok: false, result: staleBeforeStaging };

  const persisted = await opened.graph.putObjects([
    artifacts.resolutionSet,
    artifacts.resolvedAttempt,
  ]);
  if (persisted.status !== 'success') {
    return { ok: false, diagnostics: mapProviderDiagnostics(persisted.diagnostics) };
  }

  const begin = await opened.intentStore.beginIntent({
    intentId,
    idempotencyKey,
    applyKind: 'mergeCommit',
    base: payload.base,
    ours: payload.ours,
    theirs: payload.theirs,
    targetRef: options.targetRef,
    expectedTargetHead: options.expectedTargetHead,
    resultDigest,
    resolutionSetDigest: artifacts.resolutionSet.digest,
    resolvedAttemptDigest: artifacts.resolvedAttempt.digest,
    createdAt: new Date().toISOString(),
  });
  if (begin.status === 'failed' || begin.status === 'conflict') {
    return { ok: false, diagnostics: intentStoreDiagnostics(begin.diagnostics) };
  }
  return { ok: true, store: opened.intentStore, intent: begin.record };
}

type PreparedResolvedAttemptArtifacts =
  | {
      readonly ok: true;
      readonly resolutionSet: MergeResolutionSetArtifactRecord;
      readonly resolvedAttempt: ResolvedMergeAttemptArtifactRecord;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

async function prepareResolvedAttemptArtifacts(
  namespace: VersionGraphNamespace,
  input: NormalizedPersistedApplyMergeInput,
  options: Extract<NormalizedPersistedApplyMergeOptions, { readonly mode: 'apply' }>,
  resultDigest: InternalObjectDigest,
): Promise<PreparedResolvedAttemptArtifacts> {
  const legacy = await createResolvedAttemptArtifacts(namespace, {
    resultDigest,
    options,
    resolutionSet: await createMergeResolutionSetArtifactRecord(namespace, input.resolutions),
  });
  const hasExpectedDigest =
    Boolean(input.resolutionSetDigest) || Boolean(input.resolvedAttemptDigest);
  if (!hasExpectedDigest) return { ok: true, ...legacy };

  const legacyDiagnostics = validateResolvedAttemptDigests(input, {
    resolutionSetDigest: legacy.resolutionSet.digest,
    resolvedAttemptDigest: legacy.resolvedAttempt.digest,
  });
  if (legacyDiagnostics.length === 0) return { ok: true, ...legacy };

  const boundResolutionSet = await createMergeResolutionSetArtifactRecord(namespace, {
    resultId: input.resultId,
    resultDigest,
    previewArtifactDigest: resultDigest,
    resolutions: input.resolutions,
  });
  const bound = await createResolvedAttemptArtifacts(namespace, {
    resultDigest,
    options,
    resolutionSet: boundResolutionSet,
  });
  const boundDiagnostics = validateResolvedAttemptDigests(input, {
    resolutionSetDigest: bound.resolutionSet.digest,
    resolvedAttemptDigest: bound.resolvedAttempt.digest,
  });
  if (boundDiagnostics.length === 0) return { ok: true, ...bound };

  return { ok: false, diagnostics: legacyDiagnostics };
}

async function createResolvedAttemptArtifacts(
  namespace: VersionGraphNamespace,
  input: {
    readonly resultDigest: InternalObjectDigest;
    readonly options: Extract<NormalizedPersistedApplyMergeOptions, { readonly mode: 'apply' }>;
    readonly resolutionSet: MergeResolutionSetArtifactRecord;
  },
): Promise<{
  readonly resolutionSet: MergeResolutionSetArtifactRecord;
  readonly resolvedAttempt: ResolvedMergeAttemptArtifactRecord;
}> {
  const resolvedAttempt = await createResolvedMergeAttemptArtifactRecordForResolutionSet(
    namespace,
    {
      resultDigest: input.resultDigest,
      resolutionSetRecord: input.resolutionSet,
      targetRef: input.options.targetRef,
      expectedTargetHead: input.options.expectedTargetHead,
    },
  );
  return { resolutionSet: input.resolutionSet, resolvedAttempt };
}
