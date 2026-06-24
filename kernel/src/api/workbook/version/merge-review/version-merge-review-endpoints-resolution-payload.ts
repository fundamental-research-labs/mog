import type {
  JsonValue,
  VersionPutMergeResolutionPayloadRequest,
  VersionPutMergeResolutionPayloadResult,
  VersionResult,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  findExpectedConflict,
  findResolutionOptionForConflictSet,
  normalizeMergeReviewConflicts,
  validateResolutionPayloadPurpose,
} from './version-merge-review-conflicts';
import {
  createMergeReviewPayloadRecord,
  mapMergeReviewProviderDiagnostics,
  mergeReviewDiagnostic,
  mergeReviewProviderErrorDiagnostic,
  openMergeReviewGraph,
  toInternalSha256Digest,
  validateMergePreviewIdentity,
} from './version-merge-review-artifacts';
import {
  cloneJson,
  normalizePutMergeResolutionPayloadInput,
  validateRequiredTarget,
} from './version-merge-review-normalization';
import {
  mergeEndpointFailure,
  mergeEndpointPreflight,
  readMergePreviewArtifact,
} from './version-merge-review-endpoints-shared';

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
