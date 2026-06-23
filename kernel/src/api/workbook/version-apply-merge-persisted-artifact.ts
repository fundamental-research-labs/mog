import type {
  ObjectDigest,
  VersionApplyMergeResult,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeResultId,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  hasMergeApplyIntentStoreProvider,
  idempotencyKeyForResolvedAttempt,
  intentIdForResolvedAttemptDigest,
  type MergeApplyIntentRecord,
  type MergeApplyIntentStore,
} from '../../document/version-store/merge-apply-intent-store';
import {
  MERGE_PREVIEW_OBJECT_TYPE,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  mergePreviewArtifactRef,
  type MergePreviewArtifactPayload,
} from '../../document/version-store/merge-attempt-artifacts';
import type { ObjectDigest as InternalObjectDigest } from '../../document/version-store/object-digest';
import type { VersionGraphNamespace } from '../../document/version-store/object-store';
import type { VersionStoreProvider } from '../../document/version-store/provider';
import { namespaceForRegistry } from '../../document/version-store/registry';
import type { VersionGraphStore } from '../../document/version-store/provider-graph-store';
import {
  isApplyMergeWriteSuccessResult,
  mapApplyMergeWriteResult,
} from './version-apply-merge-write-result';
import {
  applyMergeServiceUnavailableDiagnostic,
  blockedApplyMergeResult,
  intentStoreDiagnostics,
  invalidPreviewArtifactDiagnostic,
  mapProviderDiagnostics,
  persistedPreviewArtifactReadDiagnostic,
  providerErrorDiagnostic,
  publicDiagnostic,
  resolutionMismatchDiagnostic,
} from './version-apply-merge-persisted-artifact-diagnostics';
import { materializableMergePlanDiagnostics } from './version-merge-materializer-support';
import type {
  NormalizedPersistedApplyMergeInput,
  NormalizedPersistedApplyMergeOptions,
} from './version-apply-merge-persisted';
import {
  recoverStagedMergeCommitIfAlreadyApplied,
  validatePreparedMergeApplyArtifactIntentRecord,
  validateAppliedMergeCommitIdentity,
} from './version-apply-merge-persisted-artifact-recovery';
import { validateSealedResolutionPayloadRefs } from './version-merge-sealed-payload';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionApplyMergeService = {
  readonly mergeCommit?: (input: {
    readonly base: WorkbookCommitId;
    readonly ours: WorkbookCommitId;
    readonly theirs: WorkbookCommitId;
    readonly targetRef: VersionMainRefName | VersionRefName;
    readonly expectedTargetHead: VersionCommitExpectedHead;
    readonly changes: readonly VersionMergeChange[];
    readonly resolutionCount: number;
    readonly resolvedMergeAttemptDigest?: InternalObjectDigest;
  }) => MaybePromise<unknown>;
};

type AttachedVersionServices = {
  readonly provider?: unknown;
  readonly versionStoreProvider?: unknown;
  readonly storeProvider?: unknown;
  readonly writeService?: unknown;
  readonly versionWriteService?: unknown;
  readonly commitService?: unknown;
  readonly applyMergeService?: unknown;
  readonly versionApplyMergeService?: unknown;
  readonly publicService?: unknown;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type ResolutionPlanResult =
  | {
      readonly ok: true;
      readonly changes: readonly VersionMergeChange[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

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

  const sealedPayloadDiagnostics = await validateSealedResolutionPayloadRefs({
    graph: opened.graph,
    operation: 'applyMerge',
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

function validatePreviewDigestInput(
  input: NormalizedPersistedApplyMergeInput,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (
    input.previewArtifactDigest &&
    !digestsEqual(input.previewArtifactDigest, input.resultDigest)
  ) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge previewArtifactDigest does not match resultDigest.',
      ),
    );
  }
  if (!isInternalSha256Digest(input.resultDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic('persisted merge resultDigest is not a merge-preview digest.'),
    );
  }
  if (input.previewArtifactDigest && !isInternalSha256Digest(input.previewArtifactDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge previewArtifactDigest is not a merge-preview digest.',
      ),
    );
  }
  return diagnostics;
}

function replayPreviewArtifact(
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

function previewArtifactMetadata(input: NormalizedPersistedApplyMergeInput) {
  return {
    resultId: input.resultId,
    previewArtifactDigest: input.resultDigest,
    resultDigest: input.resultDigest,
  };
}

async function openPersistedMergeGraph(ctx: DocumentContext): Promise<
  | {
      readonly ok: true;
      readonly namespace: VersionGraphNamespace;
      readonly graph: VersionGraphStore;
      readonly intentStore: MergeApplyIntentStore | null;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const provider = getAttachedVersionStoreProvider(ctx);
  if (!provider) {
    return {
      ok: false,
      diagnostics: [
        publicDiagnostic(
          'VERSION_STORE_UNAVAILABLE',
          'No version graph provider is attached for persisted applyMerge.',
          { recoverability: 'unsupported' },
        ),
      ],
    };
  }

  try {
    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') {
      return { ok: false, diagnostics: mapProviderDiagnostics(registry.diagnostics) };
    }
    const namespace = namespaceForRegistry(registry.registry);
    return {
      ok: true,
      namespace,
      graph: await provider.openGraph(namespace, provider.accessContext),
      intentStore: hasMergeApplyIntentStoreProvider(provider)
        ? await provider.openMergeApplyIntentStore(namespace)
        : null,
    };
  } catch {
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }
}

async function readPreviewArtifact(
  graph: VersionGraphStore,
  digest: ObjectDigest,
): Promise<
  | { readonly ok: true; readonly payload: MergePreviewArtifactPayload }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  try {
    const internalDigest = toInternalSha256Digest(digest);
    if (!internalDigest) return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic()] };
    const record = await graph.getObjectRecord<unknown>(mergePreviewArtifactRef(internalDigest));
    if (record.preimage.objectType !== MERGE_PREVIEW_OBJECT_TYPE) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic()] };
    }
    const payload = toMergePreviewArtifactPayload(record.preimage.payload);
    if (!payload) return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic()] };
    return { ok: true, payload };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [persistedPreviewArtifactReadDiagnostic(error)],
    };
  }
}

function planPreviewArtifactApply(
  payload: MergePreviewArtifactPayload,
  resolutions: readonly VersionApplyMergeResolution[],
): ResolutionPlanResult {
  if (payload.status === 'clean') {
    if (resolutions.length > 0) {
      return {
        ok: false,
        diagnostics: [
          resolutionMismatchDiagnostic('clean merge preview artifacts do not accept resolutions.'),
        ],
      };
    }
    if (payload.conflicts.length > 0) {
      return {
        ok: false,
        diagnostics: [
          resolutionMismatchDiagnostic('clean merge preview artifacts must not contain conflicts.'),
        ],
      };
    }
    return { ok: true, changes: [] };
  }

  if (payload.status === 'conflicted') {
    if (resolutions.length === 0) {
      return {
        ok: false,
        diagnostics: [
          resolutionMismatchDiagnostic(
            'applyMerge apply mode requires resolutions for conflicted previews.',
          ),
        ],
      };
    }
    return planResolvedConflicts(payload.conflicts, resolutions);
  }

  return {
    ok: false,
    diagnostics: [
      resolutionMismatchDiagnostic(
        'persisted merge preview artifact is not a review-only applyable result.',
      ),
    ],
  };
}

function validatePreviewArtifactForApply(
  payload: MergePreviewArtifactPayload,
  options: Extract<NormalizedPersistedApplyMergeOptions, { readonly mode: 'apply' }>,
): readonly VersionStoreDiagnostic[] {
  if (options.expectedTargetHead.commitId === payload.ours) return [];
  return [
    resolutionMismatchDiagnostic('applyMerge expectedTargetHead must match the ours commit.'),
  ];
}

async function staleTargetHeadBeforeStaging(
  graph: VersionGraphStore,
  input: NormalizedPersistedApplyMergeInput,
  payload: MergePreviewArtifactPayload,
  options: Extract<NormalizedPersistedApplyMergeOptions, { readonly mode: 'apply' }>,
): Promise<VersionApplyMergeResult | null> {
  const current = await readCurrentTargetHead(graph, options.targetRef);
  if (!current.ok) {
    return blockedApplyMergeResult(payload.base, payload.ours, payload.theirs, current.diagnostics);
  }
  if (current.commitId === options.expectedTargetHead.commitId) return null;
  return staleTargetHeadPreviewArtifactResult(input, payload, options, current.commitId);
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

  const resolutionSet = await createMergeResolutionSetArtifactRecord(
    opened.namespace,
    input.resolutions,
  );
  const resolvedAttempt = await createResolvedMergeAttemptArtifactRecord(opened.namespace, {
    resultDigest,
    resolutionSetDigest: resolutionSet.digest,
    targetRef: options.targetRef,
    expectedTargetHead: options.expectedTargetHead,
  });
  const digestDiagnostics = validateResolvedAttemptDigests(input, {
    resolutionSetDigest: resolutionSet.digest,
    resolvedAttemptDigest: resolvedAttempt.digest,
  });
  if (digestDiagnostics.length > 0) {
    return { ok: false, diagnostics: digestDiagnostics };
  }

  const intentId = intentIdForResolvedAttemptDigest(resolvedAttempt.digest);
  const idempotencyKey = idempotencyKeyForResolvedAttempt({
    resolvedAttemptDigest: resolvedAttempt.digest,
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
        resolutionSetDigest: resolutionSet.digest,
        resolvedAttemptDigest: resolvedAttempt.digest,
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

  const persisted = await opened.graph.putObjects([resolutionSet, resolvedAttempt]);
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
    resolutionSetDigest: resolutionSet.digest,
    resolvedAttemptDigest: resolvedAttempt.digest,
    createdAt: new Date().toISOString(),
  });
  if (begin.status === 'failed' || begin.status === 'conflict') {
    return { ok: false, diagnostics: intentStoreDiagnostics(begin.diagnostics) };
  }
  return { ok: true, store: opened.intentStore, intent: begin.record };
}

function validateResolvedAttemptDigests(
  input: NormalizedPersistedApplyMergeInput,
  expected: {
    readonly resolutionSetDigest: InternalObjectDigest;
    readonly resolvedAttemptDigest: InternalObjectDigest;
  },
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (
    input.resolutionSetDigest &&
    !digestsEqual(input.resolutionSetDigest, expected.resolutionSetDigest)
  ) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge resolutionSetDigest does not match the resolved artifact.',
      ),
    );
  }
  if (
    input.resolvedAttemptDigest &&
    !digestsEqual(input.resolvedAttemptDigest, expected.resolvedAttemptDigest)
  ) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge resolvedAttemptDigest does not match the resolved artifact.',
      ),
    );
  }
  return diagnostics;
}

async function resultFromTerminalArtifactIntent(
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

async function readCurrentTargetHead(
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

function staleTargetHeadPreviewArtifactResult(
  input: NormalizedPersistedApplyMergeInput,
  payload: MergePreviewArtifactPayload,
  options: Extract<NormalizedPersistedApplyMergeOptions, { readonly mode: 'apply' }>,
  currentHead: WorkbookCommitId,
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
    diagnostics: [],
    mutationGuarantee: 'ref-not-mutated',
  };
}

function staleTargetHeadArtifactResult(
  input: NormalizedPersistedApplyMergeInput,
  record: MergeApplyIntentRecord,
  currentHead: WorkbookCommitId,
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
    diagnostics: [],
    mutationGuarantee: 'ref-not-mutated',
  };
}

function applyArtifactMetadata(
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

function planResolvedConflicts(
  conflicts: readonly VersionMergeConflict[],
  resolutions: readonly VersionApplyMergeResolution[],
): ResolutionPlanResult {
  if (resolutions.length !== conflicts.length) {
    return {
      ok: false,
      diagnostics: [
        resolutionMismatchDiagnostic(
          'applyMerge preview requires exactly one resolution per conflict.',
        ),
      ],
    };
  }

  const conflictsById = new Map(conflicts.map((conflict) => [conflict.conflictId, conflict]));
  const seenConflictIds = new Set<string>();
  const changes: VersionMergeChange[] = [];

  for (const resolution of resolutions) {
    if (seenConflictIds.has(resolution.conflictId)) {
      return {
        ok: false,
        diagnostics: [resolutionMismatchDiagnostic('duplicate conflict resolution supplied.')],
      };
    }
    seenConflictIds.add(resolution.conflictId);

    const conflict = conflictsById.get(resolution.conflictId);
    if (!conflict || resolution.expectedConflictDigest !== conflict.conflictDigest) {
      return {
        ok: false,
        diagnostics: [
          resolutionMismatchDiagnostic('resolution does not match the merge conflict.'),
        ],
      };
    }

    const option = conflict.resolutionOptions.find(
      (candidate) =>
        candidate.optionId === resolution.optionId && candidate.kind === resolution.kind,
    );
    if (!option) {
      return {
        ok: false,
        diagnostics: [
          resolutionMismatchDiagnostic('resolution option does not match the conflict.'),
        ],
      };
    }

    changes.push({
      structural: conflict.structural,
      base: conflict.base,
      ours: conflict.ours,
      theirs: conflict.theirs,
      merged: option.value,
      ...(conflict.display ? { display: conflict.display } : {}),
      ...(option.diagnostics && option.diagnostics.length > 0
        ? { diagnostics: option.diagnostics }
        : {}),
    });
  }

  return { ok: true, changes };
}

function toMergePreviewArtifactPayload(value: unknown): MergePreviewArtifactPayload | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.recordKind !== 'mergePreview') {
    return null;
  }
  if (
    value.status !== 'clean' &&
    value.status !== 'conflicted' &&
    value.status !== 'fastForward' &&
    value.status !== 'alreadyMerged'
  ) {
    return null;
  }
  if (
    !isWorkbookCommitId(value.base) ||
    !isWorkbookCommitId(value.ours) ||
    !isWorkbookCommitId(value.theirs) ||
    !Array.isArray(value.changes) ||
    !Array.isArray(value.conflicts)
  ) {
    return null;
  }
  return value as unknown as MergePreviewArtifactPayload;
}

function getAttachedVersionStoreProvider(ctx: DocumentContext): VersionStoreProvider | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  for (const candidate of [
    services.provider,
    services.versionStoreProvider,
    services.storeProvider,
    services,
  ]) {
    if (hasVersionStoreProviderReads(candidate)) return candidate as VersionStoreProvider;
  }
  return null;
}

function getAttachedVersionApplyMergeService(
  ctx: DocumentContext,
): AttachedVersionApplyMergeService | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  for (const candidate of [
    services.applyMergeService,
    services.versionApplyMergeService,
    services.writeService,
    services.versionWriteService,
    services.commitService,
    services.publicService,
  ]) {
    const service = toApplyMergeService(candidate);
    if (service) return service;
  }
  return null;
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? (services as AttachedVersionServices) : null;
}

function toApplyMergeService(value: unknown): AttachedVersionApplyMergeService | null {
  const mergeCommit =
    bindMethod(value, 'mergeCommit') ??
    bindMethod(value, 'applyMerge') ??
    bindMethod(value, 'applyMergeVersion') ??
    bindMethod(value, 'applyMergeCommit');
  if (!mergeCommit) return null;
  return { mergeCommit: (input) => mergeCommit(input) };
}

function hasVersionStoreProviderReads(value: unknown): value is VersionStoreProvider {
  return isRecord(value) && typeof value.readGraphRegistry === 'function';
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function digestsEqual(
  left: { readonly algorithm: string; readonly digest: string },
  right: { readonly algorithm: string; readonly digest: string },
): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function isInternalSha256Digest(value: ObjectDigest): boolean {
  return Boolean(toInternalSha256Digest(value));
}

function toInternalSha256Digest(value: ObjectDigest): InternalObjectDigest | null {
  return value.algorithm === 'sha256' ? (value as InternalObjectDigest) : null;
}

function isWorkbookCommitId(value: unknown): value is WorkbookCommitId {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
