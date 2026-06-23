import type {
  JsonValue,
  ObjectDigest,
  VersionGetMergeConflictDetailRequest,
  VersionMergeConflictDetailResult,
  VersionPutMergeResolutionPayloadRequest,
  VersionPutMergeResolutionPayloadResult,
  VersionResult,
  VersionSaveMergeResolutionsRequest,
  VersionSaveMergeResolutionsResult,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  MERGE_PREVIEW_OBJECT_TYPE,
  mergePreviewArtifactRef,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  type MergePreviewArtifactPayload,
} from '../../document/version-store/merge-attempt-artifacts';
import type { VersionGraphStore } from '../../document/version-store/provider-graph-store';
import {
  findExpectedConflict,
  findResolutionOptionForConflictSet,
  normalizeMergeReviewConflicts,
  projectResolutionOptions,
  projectReviewValue,
  selectConflictDetailValue,
  validateResolutionPayloadPurpose,
  validateResolutionsForConflictSet,
} from './version-merge-review-conflicts';
import {
  createMergeReviewPayloadRecord,
  mapMergeReviewProviderDiagnostics,
  mergeReviewDiagnostic,
  mergeReviewProviderErrorDiagnostic,
  openMergeReviewGraph,
  persistedReviewArtifactReadDiagnostics,
  toInternalSha256Digest,
  validateMergePreviewIdentity,
} from './version-merge-review-artifacts';
import {
  cloneJson,
  normalizeGetMergeConflictDetailInput,
  normalizePutMergeResolutionPayloadInput,
  normalizeSaveMergeResolutionsInput,
  validateOptionalTarget,
  validateRequiredTarget,
} from './version-merge-review-normalization';
import {
  getVersionMergeCapabilityDecision,
  type VersionMergePublicOperation,
  type VersionMergePublicCapability,
  versionMergeCapabilityDisabledDiagnostic,
} from './version-merge-capability';
import {
  versionFailureFromStoreDiagnostics,
  versionResultFromMergeEndpointDiagnostics,
} from './version-result';
import { validateSealedResolutionPayloadRefs } from './version-merge-sealed-payload';
import { resolveSavedConflictDetailSelection } from './version-merge-review-saved-resolution';

export async function saveMergeResolutionsWorkbookVersion(
  ctx: DocumentContext,
  input: VersionSaveMergeResolutionsRequest,
): Promise<VersionResult<VersionSaveMergeResolutionsResult>> {
  const preflight = mergeEndpointPreflight<VersionSaveMergeResolutionsResult>(
    ctx,
    'saveMergeResolutions',
  );
  if (preflight) return preflight;

  const normalized = normalizeSaveMergeResolutionsInput(input);
  if (!normalized.ok) return mergeEndpointFailure('saveMergeResolutions', normalized.diagnostics);

  const identityDiagnostics = validateMergePreviewIdentity(
    'saveMergeResolutions',
    normalized.input.resultId,
    normalized.input.resultDigest,
  );
  if (identityDiagnostics.length > 0) {
    return mergeEndpointFailure('saveMergeResolutions', identityDiagnostics);
  }

  const opened = await openMergeReviewGraph(ctx, 'saveMergeResolutions');
  if (!opened.ok) return mergeEndpointFailure('saveMergeResolutions', opened.diagnostics);

  const artifact = await readMergePreviewArtifact(
    opened.graph,
    'saveMergeResolutions',
    normalized.input.resultDigest,
  );
  if (!artifact.ok) return mergeEndpointFailure('saveMergeResolutions', artifact.diagnostics);

  const targetDiagnostics = validateOptionalTarget(
    'saveMergeResolutions',
    artifact.payload.ours,
    normalized.input.targetRef,
    normalized.input.expectedTargetHead,
  );
  if (targetDiagnostics.length > 0) {
    return mergeEndpointFailure('saveMergeResolutions', targetDiagnostics);
  }

  if (artifact.payload.status !== 'clean' && artifact.payload.status !== 'conflicted') {
    return mergeEndpointFailure('saveMergeResolutions', [
      mergeReviewDiagnostic(
        'saveMergeResolutions',
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'ancestry merge preview artifacts do not accept saved resolutions.',
      ),
    ]);
  }
  const conflictSet = await normalizeMergeReviewConflicts(
    'saveMergeResolutions',
    artifact.payload.conflicts,
  );
  if (!conflictSet.ok) {
    return mergeEndpointFailure('saveMergeResolutions', conflictSet.diagnostics);
  }

  const resolutionValidation = validateResolutionsForConflictSet(
    'saveMergeResolutions',
    { status: artifact.payload.status },
    conflictSet.conflictSet,
    normalized.input.resolutions,
  );
  if (!resolutionValidation.ok) {
    return mergeEndpointFailure('saveMergeResolutions', resolutionValidation.diagnostics);
  }
  const target =
    normalized.input.targetRef && normalized.input.expectedTargetHead
      ? {
          targetRef: normalized.input.targetRef,
          expectedTargetHead: normalized.input.expectedTargetHead,
        }
      : null;
  const sealedPayloadDiagnostics = await validateSealedResolutionPayloadRefs({
    graph: opened.graph,
    operation: 'saveMergeResolutions',
    allowExecutablePayloadRefs: Boolean(target && resolutionValidation.status === 'readyToApply'),
    resultId: normalized.input.resultId,
    resultDigest: normalized.input.resultDigest,
    redactionPolicyDigest: normalized.input.redactionPolicyDigest,
    ...(target
      ? { targetRef: target.targetRef, expectedTargetHead: target.expectedTargetHead }
      : {}),
    conflicts: conflictSet.conflictSet.conflicts,
    resolutions: resolutionValidation.resolutions,
  });
  if (sealedPayloadDiagnostics.length > 0) {
    return mergeEndpointFailure('saveMergeResolutions', sealedPayloadDiagnostics);
  }

  try {
    const resolutionSet = await createMergeResolutionSetArtifactRecord(
      opened.namespace,
      resolutionValidation.resolutions,
    );
    const resultDigest = toInternalSha256Digest(normalized.input.resultDigest);
    if (!resultDigest) {
      return mergeEndpointFailure('saveMergeResolutions', [
        mergeReviewDiagnostic(
          'saveMergeResolutions',
          'VERSION_INVALID_OPTIONS',
          'resultDigest must be a sha256 merge preview digest.',
          { payload: { option: 'resultDigest' } },
        ),
      ]);
    }
    const resolvedAttempt =
      target && resolutionValidation.status === 'readyToApply'
        ? await createResolvedMergeAttemptArtifactRecord(opened.namespace, {
            resultDigest,
            resolutionSetDigest: resolutionSet.digest,
            targetRef: target.targetRef,
            expectedTargetHead: target.expectedTargetHead,
          })
        : null;
    const persisted = await opened.graph.putObjects(
      resolvedAttempt ? [resolutionSet, resolvedAttempt] : [resolutionSet],
    );
    if (persisted.status !== 'success') {
      return mergeEndpointFailure(
        'saveMergeResolutions',
        mapMergeReviewProviderDiagnostics('saveMergeResolutions', persisted.diagnostics),
      );
    }

    return {
      ok: true,
      value: {
        schemaVersion: 1,
        kind: 'mergeResolutionsSaved',
        status: resolutionValidation.status,
        resultId: normalized.input.resultId,
        resultDigest: normalized.input.resultDigest,
        resolutionSetDigest: resolutionSet.digest,
        ...(resolvedAttempt ? { resolvedAttemptDigest: resolvedAttempt.digest } : {}),
        attemptKind: resolvedAttempt ? 'applyable' : 'reviewOnly',
        attemptPersistence: 'persisted',
        ...(target
          ? { targetRef: target.targetRef, expectedTargetHead: target.expectedTargetHead }
          : {}),
        savedResolutionCount: normalized.input.resolutions.length,
        diagnostics: [],
      },
    };
  } catch {
    return mergeEndpointFailure('saveMergeResolutions', [
      mergeReviewProviderErrorDiagnostic('saveMergeResolutions'),
    ]);
  }
}

export async function getMergeConflictDetailWorkbookVersion(
  ctx: DocumentContext,
  input: VersionGetMergeConflictDetailRequest,
): Promise<VersionResult<VersionMergeConflictDetailResult>> {
  const preflight = mergeEndpointPreflight<VersionMergeConflictDetailResult>(
    ctx,
    'getMergeConflictDetail',
  );
  if (preflight) return preflight;

  const normalized = normalizeGetMergeConflictDetailInput(input);
  if (!normalized.ok) return mergeEndpointFailure('getMergeConflictDetail', normalized.diagnostics);

  const identityDiagnostics = validateMergePreviewIdentity(
    'getMergeConflictDetail',
    normalized.input.resultId,
    normalized.input.resultDigest,
  );
  if (identityDiagnostics.length > 0) {
    return mergeEndpointFailure('getMergeConflictDetail', identityDiagnostics);
  }

  const opened = await openMergeReviewGraph(ctx, 'getMergeConflictDetail');
  if (!opened.ok) return mergeEndpointFailure('getMergeConflictDetail', opened.diagnostics);

  const artifact = await readMergePreviewArtifact(
    opened.graph,
    'getMergeConflictDetail',
    normalized.input.resultDigest,
  );
  if (!artifact.ok) return mergeEndpointFailure('getMergeConflictDetail', artifact.diagnostics);

  const targetDiagnostics = validateOptionalTarget(
    'getMergeConflictDetail',
    artifact.payload.ours,
    normalized.input.targetRef,
    normalized.input.expectedTargetHead,
  );
  if (targetDiagnostics.length > 0) {
    return mergeEndpointFailure('getMergeConflictDetail', targetDiagnostics);
  }

  if (artifact.payload.status !== 'clean' && artifact.payload.status !== 'conflicted') {
    return mergeEndpointFailure('getMergeConflictDetail', [
      mergeReviewDiagnostic(
        'getMergeConflictDetail',
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'ancestry merge preview artifacts do not expose conflict detail.',
      ),
    ]);
  }

  const conflictSet = await normalizeMergeReviewConflicts(
    'getMergeConflictDetail',
    artifact.payload.conflicts,
  );
  if (!conflictSet.ok) {
    return mergeEndpointFailure('getMergeConflictDetail', conflictSet.diagnostics);
  }

  const conflict = findExpectedConflict(
    'getMergeConflictDetail',
    conflictSet.conflictSet,
    normalized.input.conflictId,
    normalized.input.expectedConflictDigest,
  );
  if (!conflict.ok) return mergeEndpointFailure('getMergeConflictDetail', conflict.diagnostics);

  const savedSelection = await resolveSavedConflictDetailSelection(
    opened.graph,
    'getMergeConflictDetail',
    normalized.input,
    conflictSet.conflictSet,
    conflict.conflict,
  );
  if (!savedSelection.ok) {
    return mergeEndpointFailure('getMergeConflictDetail', savedSelection.diagnostics);
  }

  const selected = selectConflictDetailValue(
    'getMergeConflictDetail',
    conflictSet.conflictSet,
    conflict.conflict,
    savedSelection.selection,
  );
  if (!selected.ok) return mergeEndpointFailure('getMergeConflictDetail', selected.diagnostics);

  const value = projectReviewValue(
    'getMergeConflictDetail',
    conflict.conflict.structural,
    selected.value,
  );
  if (!value.ok) return mergeEndpointFailure('getMergeConflictDetail', value.diagnostics);

  const resolutionOptions = projectResolutionOptions('getMergeConflictDetail', conflict.conflict);
  if (!resolutionOptions.ok) {
    return mergeEndpointFailure('getMergeConflictDetail', resolutionOptions.diagnostics);
  }

  const resultBase = {
    schemaVersion: 1 as const,
    conflictId: conflict.conflict.conflictId,
    conflictDigest: conflict.conflict.conflictDigest,
    valueRole: savedSelection.selection.valueRole,
    purpose: normalized.input.purpose,
    resolutionOptions: resolutionOptions.options,
    value: value.value,
  };
  return {
    ok: true,
    value:
      normalized.input.purpose === 'review'
        ? { ...resultBase, kind: 'reviewValue' }
        : { ...resultBase, kind: 'resolutionPayload' },
  };
}

export async function putMergeResolutionPayloadWorkbookVersion(
  ctx: DocumentContext,
  input: VersionPutMergeResolutionPayloadRequest,
): Promise<VersionResult<VersionPutMergeResolutionPayloadResult>> {
  const preflight = mergeEndpointPreflight<VersionPutMergeResolutionPayloadResult>(
    ctx,
    'putMergeResolutionPayload',
  );
  if (preflight) return preflight;

  const normalized = normalizePutMergeResolutionPayloadInput(input);
  if (!normalized.ok)
    return mergeEndpointFailure('putMergeResolutionPayload', normalized.diagnostics);

  const identityDiagnostics = validateMergePreviewIdentity(
    'putMergeResolutionPayload',
    normalized.input.resultId,
    normalized.input.resultDigest,
  );
  if (identityDiagnostics.length > 0) {
    return mergeEndpointFailure('putMergeResolutionPayload', identityDiagnostics);
  }

  const opened = await openMergeReviewGraph(ctx, 'putMergeResolutionPayload');
  if (!opened.ok) return mergeEndpointFailure('putMergeResolutionPayload', opened.diagnostics);

  const artifact = await readMergePreviewArtifact(
    opened.graph,
    'putMergeResolutionPayload',
    normalized.input.resultDigest,
  );
  if (!artifact.ok) return mergeEndpointFailure('putMergeResolutionPayload', artifact.diagnostics);

  if (artifact.payload.status !== 'clean' && artifact.payload.status !== 'conflicted') {
    return mergeEndpointFailure('putMergeResolutionPayload', [
      mergeReviewDiagnostic(
        'putMergeResolutionPayload',
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'ancestry merge preview artifacts do not accept resolution payloads.',
      ),
    ]);
  }

  const conflictSet = await normalizeMergeReviewConflicts(
    'putMergeResolutionPayload',
    artifact.payload.conflicts,
  );
  if (!conflictSet.ok) {
    return mergeEndpointFailure('putMergeResolutionPayload', conflictSet.diagnostics);
  }

  const targetDiagnostics = validateRequiredTarget(
    'putMergeResolutionPayload',
    artifact.payload.ours,
    normalized.input.targetRef,
    normalized.input.expectedTargetHead,
  );
  if (targetDiagnostics.length > 0) {
    return mergeEndpointFailure('putMergeResolutionPayload', targetDiagnostics);
  }

  const conflict = findExpectedConflict(
    'putMergeResolutionPayload',
    conflictSet.conflictSet,
    normalized.input.conflictId,
    normalized.input.expectedConflictDigest,
  );
  if (!conflict.ok) return mergeEndpointFailure('putMergeResolutionPayload', conflict.diagnostics);

  const option = findResolutionOptionForConflictSet(
    conflictSet.conflictSet,
    conflict.conflict,
    normalized.input.optionId,
    normalized.input.kind,
  );
  if (!option) {
    return mergeEndpointFailure('putMergeResolutionPayload', [
      mergeReviewDiagnostic(
        'putMergeResolutionPayload',
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'resolution option does not match the conflict.',
      ),
    ]);
  }

  const payloadDiagnostics = validateResolutionPayloadPurpose(
    conflict.conflict,
    option,
    normalized.input,
  );
  if (payloadDiagnostics.length > 0) {
    return mergeEndpointFailure('putMergeResolutionPayload', payloadDiagnostics);
  }

  const resultDigest = toInternalSha256Digest(normalized.input.resultDigest);
  if (!resultDigest) {
    return mergeEndpointFailure('putMergeResolutionPayload', [
      mergeReviewDiagnostic(
        'putMergeResolutionPayload',
        'VERSION_INVALID_OPTIONS',
        'resultDigest must be a sha256 merge preview digest.',
        { payload: { option: 'resultDigest' } },
      ),
    ]);
  }

  try {
    const payloadRecord = await createMergeReviewPayloadRecord(opened.namespace, {
      resultId: normalized.input.resultId,
      resultDigest,
      redactionPolicyDigest: normalized.input.redactionPolicyDigest,
      conflictId: conflict.conflict.conflictId,
      expectedConflictDigest: conflict.conflict.conflictDigest,
      optionId: option.optionId,
      kind: normalized.input.kind,
      targetRef: normalized.input.targetRef,
      expectedTargetHead: cloneJson(normalized.input.expectedTargetHead) as unknown as JsonValue,
      purpose: normalized.input.purpose,
      ...(normalized.input.domainPayloadSchema === undefined
        ? {}
        : { domainPayloadSchema: normalized.input.domainPayloadSchema }),
      value: normalized.input.value,
    });
    const persisted = await opened.graph.putObjects([payloadRecord]);
    if (persisted.status !== 'success') {
      return mergeEndpointFailure(
        'putMergeResolutionPayload',
        mapMergeReviewProviderDiagnostics('putMergeResolutionPayload', persisted.diagnostics),
      );
    }
    return {
      ok: true,
      value: {
        schemaVersion: 1,
        kind: 'sealedResolutionPayload',
        payloadId: `merge-payload:${payloadRecord.digest.digest}`,
        payloadDigest: payloadRecord.digest,
        storageMode: 'serverEncrypted',
        resultId: normalized.input.resultId,
        resultDigest: normalized.input.resultDigest,
        conflictId: conflict.conflict.conflictId,
        optionId: option.optionId,
        resolutionKind: normalized.input.kind,
      },
    };
  } catch {
    return mergeEndpointFailure('putMergeResolutionPayload', [
      mergeReviewProviderErrorDiagnostic('putMergeResolutionPayload'),
    ]);
  }
}

type MergeReviewPreviewReadResult =
  | { readonly ok: true; readonly payload: MergePreviewArtifactPayload }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

async function readMergePreviewArtifact(
  graph: VersionGraphStore,
  operation: VersionMergePublicOperation,
  digest: ObjectDigest,
): Promise<MergeReviewPreviewReadResult> {
  const internalDigest = toInternalSha256Digest(digest);
  if (!internalDigest) {
    return {
      ok: false,
      diagnostics: [
        mergeReviewDiagnostic(
          operation,
          'VERSION_INVALID_OPTIONS',
          'resultDigest must be a sha256 merge preview digest.',
          { payload: { option: 'resultDigest' } },
        ),
      ],
    };
  }

  try {
    const record = await graph.getObjectRecord<unknown>(mergePreviewArtifactRef(internalDigest));
    if (record.preimage.objectType !== MERGE_PREVIEW_OBJECT_TYPE) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    const payload = toMergePreviewArtifactPayload(record.preimage.payload);
    return payload
      ? { ok: true, payload }
      : { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
  } catch (error) {
    return {
      ok: false,
      diagnostics: persistedReviewArtifactReadDiagnostics(
        operation,
        error,
        'Persisted merge preview artifact could not be found.',
      ),
    };
  }
}

function invalidPreviewArtifactDiagnostic(
  operation: VersionMergePublicOperation,
): VersionStoreDiagnostic {
  return mergeReviewDiagnostic(
    operation,
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'Persisted merge preview artifact payload is invalid or unsupported.',
    { recoverability: 'repair' },
  );
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

function mergeEndpointPreflight<T>(
  ctx: DocumentContext,
  operation: VersionMergePublicOperation,
): VersionResult<T> | null {
  const decision = getVersionMergeCapabilityDecision(ctx, capabilityForOperation(operation));
  if (decision.enabled) return null;
  return versionResultFromMergeEndpointDiagnostics(operation, [
    versionMergeCapabilityDisabledDiagnostic(operation, decision),
  ]);
}

function capabilityForOperation(
  operation: VersionMergePublicOperation,
): VersionMergePublicCapability {
  switch (operation) {
    case 'merge':
    case 'getMergeConflictDetail':
      return 'version:mergePreview';
    case 'applyMerge':
    case 'saveMergeResolutions':
    case 'putMergeResolutionPayload':
      return 'version:mergeApply';
  }
}

function mergeEndpointFailure<T>(
  operation: VersionMergePublicOperation,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  return versionFailureFromStoreDiagnostics(operation, diagnostics);
}

function isWorkbookCommitId(value: unknown): boolean {
  return typeof value === 'string' && /^commit:sha256:[0-9a-f]{64}$/.test(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
