import type {
  VersionResult,
  VersionSaveMergeResolutionsRequest,
  VersionSaveMergeResolutionsResult,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
} from '../../../../document/version-store/merge-attempt-artifacts';
import {
  normalizeMergeReviewConflicts,
  validateResolutionsForConflictSet,
} from './version-merge-review-conflicts';
import {
  mapMergeReviewProviderDiagnostics,
  mergeReviewDiagnostic,
  mergeReviewProviderErrorDiagnostic,
  openMergeReviewGraph,
  toInternalSha256Digest,
  validateMergePreviewIdentity,
} from './version-merge-review-artifacts';
import {
  normalizeSaveMergeResolutionsInput,
  validateOptionalTarget,
} from './version-merge-review-normalization';
import {
  mergeEndpointFailure,
  mergeEndpointPreflight,
  readMergePreviewArtifact,
} from './version-merge-review-endpoints-shared';
import { validateSealedResolutionPayloadRefs } from './version-merge-sealed-payload';

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
