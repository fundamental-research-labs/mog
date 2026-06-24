import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type {
  MergeResolutionSetArtifactPayload,
  ResolvedMergeAttemptArtifactPayload,
} from '../../../../document/version-store/merge-attempt-artifacts';
import { isObjectDigest as isVersionObjectDigest } from '../../../../document/version-store/object-digest';
import { mapPublicExpectedTargetHead, mapPublicTargetRef } from '../../version-attempt-metadata';
import type { VersionMergePublicOperation } from '../../version-merge-capability';
import { normalizeVersionApplyMergeResolutions } from '../../version-merge-resolution-normalization';
import { invalidReviewArtifactDiagnostic } from './version-merge-review-saved-resolution-diagnostics';
import { hasUnknownKeys, isRecord } from './version-merge-review-saved-resolution-utils';

const MERGE_RESOLUTION_SET_ARTIFACT_KEYS = new Set(['schemaVersion', 'recordKind', 'resolutions']);
const RESOLVED_MERGE_ATTEMPT_ARTIFACT_KEYS = new Set([
  'schemaVersion',
  'recordKind',
  'resultDigest',
  'resolutionSetDigest',
  'targetRef',
  'expectedTargetHead',
]);

export function toMergeResolutionSetArtifactPayload(
  operation: VersionMergePublicOperation,
  value: unknown,
): MergeResolutionSetArtifactPayload | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.recordKind !== 'mergeResolutionSet' ||
    !Array.isArray(value.resolutions) ||
    hasUnknownKeys(value, MERGE_RESOLUTION_SET_ARTIFACT_KEYS)
  ) {
    return null;
  }
  const diagnostics: VersionStoreDiagnostic[] = [];
  const resolutions = normalizeVersionApplyMergeResolutions(value.resolutions, diagnostics, {
    allowUndefined: false,
    invalidDiagnostic: () =>
      invalidReviewArtifactDiagnostic(
        operation,
        'Persisted merge resolution set artifact payload is invalid or unsupported.',
      ),
  });
  return resolutions && diagnostics.length === 0
    ? {
        schemaVersion: 1,
        recordKind: 'mergeResolutionSet',
        resolutions,
      }
    : null;
}

export function toResolvedMergeAttemptArtifactPayload(
  value: unknown,
): ResolvedMergeAttemptArtifactPayload | null {
  if (!isRecord(value)) return null;
  if (hasUnknownKeys(value, RESOLVED_MERGE_ATTEMPT_ARTIFACT_KEYS)) return null;
  const targetRef = mapPublicTargetRef(value.targetRef);
  const expectedTargetHead = mapPublicExpectedTargetHead(value.expectedTargetHead);
  const resultDigest = isVersionObjectDigest(value.resultDigest) ? value.resultDigest : null;
  const resolutionSetDigest = isVersionObjectDigest(value.resolutionSetDigest)
    ? value.resolutionSetDigest
    : null;
  if (
    value.schemaVersion !== 1 ||
    value.recordKind !== 'resolvedMergeAttempt' ||
    !resultDigest ||
    !resolutionSetDigest ||
    !targetRef ||
    !expectedTargetHead
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    recordKind: 'resolvedMergeAttempt',
    resultDigest,
    resolutionSetDigest,
    targetRef,
    expectedTargetHead,
  };
}
