import type {
  JsonValue,
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
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
} from '../../document/version-store/merge-attempt-artifacts';
import {
  findExpectedConflict,
  findResolutionOption,
  projectResolutionOptions,
  projectReviewValue,
  selectConflictDetailValue,
  validateResolutionPayloadPurpose,
} from './version-merge-review-conflicts';
import {
  createMergeReviewPayloadRecord,
  mapMergeReviewProviderDiagnostics,
  mergeReviewDiagnostic,
  mergeReviewProviderErrorDiagnostic,
  openMergeReviewGraph,
  readMergePreviewArtifact,
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
  validateResolutionsForPreview,
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
  const resolutionPreview = {
    status: artifact.payload.status,
    conflicts: artifact.payload.conflicts,
  };

  const resolutionValidation = validateResolutionsForPreview(
    'saveMergeResolutions',
    resolutionPreview,
    normalized.input.resolutions,
  );
  if (!resolutionValidation.ok) {
    return mergeEndpointFailure('saveMergeResolutions', resolutionValidation.diagnostics);
  }

  try {
    const resolutionSet = await createMergeResolutionSetArtifactRecord(
      opened.namespace,
      normalized.input.resolutions,
    );
    const target = normalized.input.targetRef && normalized.input.expectedTargetHead
      ? {
          targetRef: normalized.input.targetRef,
          expectedTargetHead: normalized.input.expectedTargetHead,
        }
      : null;
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
        ...(target ? { targetRef: target.targetRef, expectedTargetHead: target.expectedTargetHead } : {}),
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

  const conflict = findExpectedConflict(
    'getMergeConflictDetail',
    artifact.payload.conflicts,
    normalized.input.conflictId,
    normalized.input.expectedConflictDigest,
  );
  if (!conflict.ok) return mergeEndpointFailure('getMergeConflictDetail', conflict.diagnostics);

  const selected = selectConflictDetailValue('getMergeConflictDetail', conflict.conflict, normalized.input);
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
    valueRole: normalized.input.valueRole,
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
  if (!normalized.ok) return mergeEndpointFailure('putMergeResolutionPayload', normalized.diagnostics);

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
    artifact.payload.conflicts,
    normalized.input.conflictId,
    normalized.input.expectedConflictDigest,
  );
  if (!conflict.ok) return mergeEndpointFailure('putMergeResolutionPayload', conflict.diagnostics);

  const option = findResolutionOption(
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
      conflictId: normalized.input.conflictId,
      expectedConflictDigest: normalized.input.expectedConflictDigest,
      optionId: normalized.input.optionId,
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
        conflictId: normalized.input.conflictId,
        optionId: normalized.input.optionId,
        resolutionKind: normalized.input.kind,
      },
    };
  } catch {
    return mergeEndpointFailure('putMergeResolutionPayload', [
      mergeReviewProviderErrorDiagnostic('putMergeResolutionPayload'),
    ]);
  }
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

function capabilityForOperation(operation: VersionMergePublicOperation): VersionMergePublicCapability {
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
