import type {
  ObjectDigest,
  VersionMergeResultId,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import {
  mergePreviewArtifactRef,
  type MergeResolutionSetArtifactPayload,
  type ResolvedMergeAttemptArtifactPayload,
} from '../../../../document/version-store/merge-attempt-artifacts';
import {
  isObjectDigest as isVersionObjectDigest,
  type VersionDependencyRef,
} from '../../../../document/version-store/object-digest';
import type { VersionObjectRecord } from '../../../../document/version-store/object-store';
import type { VersionMergePublicOperation } from '../merge/version-merge-capability';
import { mergeReviewDiagnostic, toInternalSha256Digest } from './version-merge-review-artifacts';
import type { NormalizedGetMergeConflictDetailInput } from './version-merge-review-normalization';
import {
  canonicalJson,
  digestsEqual,
  isRecord,
} from './version-merge-review-saved-resolution-utils';

type MergeResolutionSetBindingInput = {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
};

type ObjectDependencyRef = Extract<VersionDependencyRef, { readonly kind: 'object' }>;

export function validateResolutionSetBinding(
  operation: VersionMergePublicOperation,
  input: MergeResolutionSetBindingInput,
  payload: MergeResolutionSetArtifactPayload,
  record: VersionObjectRecord<MergeResolutionSetArtifactPayload>,
): readonly VersionStoreDiagnostic[] {
  if (payload.schemaVersion !== 2) return [];

  const diagnostics: VersionStoreDiagnostic[] = [];
  if (
    payload.resultId !== input.resultId ||
    !digestsEqual(payload.resultDigest, input.resultDigest)
  ) {
    diagnostics.push(
      mergeReviewDiagnostic(
        operation,
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'saved resolution set result binding does not match.',
      ),
    );
  }
  if (!digestsEqual(payload.previewArtifactDigest, input.resultDigest)) {
    diagnostics.push(
      mergeReviewDiagnostic(
        operation,
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'saved resolution set preview binding does not match.',
      ),
    );
  }
  if (!hasExpectedPreviewDependency(record, input.resultDigest)) {
    diagnostics.push(
      mergeReviewDiagnostic(
        operation,
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'saved resolution set artifact binding does not match.',
      ),
    );
  }
  return diagnostics;
}

export function validateResolvedAttemptBinding(
  operation: VersionMergePublicOperation,
  input: NormalizedGetMergeConflictDetailInput,
  payload: ResolvedMergeAttemptArtifactPayload,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!digestsEqual(payload.resultDigest, input.resultDigest)) {
    diagnostics.push(
      mergeReviewDiagnostic(
        operation,
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'resolved merge attempt does not match the merge preview digest.',
      ),
    );
  }
  if (input.targetRef && payload.targetRef !== input.targetRef) {
    diagnostics.push(
      mergeReviewDiagnostic(
        operation,
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'resolved merge attempt targetRef does not match.',
      ),
    );
  }
  if (
    input.expectedTargetHead &&
    canonicalJson(payload.expectedTargetHead) !== canonicalJson(input.expectedTargetHead)
  ) {
    diagnostics.push(
      mergeReviewDiagnostic(
        operation,
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'resolved merge attempt expectedTargetHead does not match.',
      ),
    );
  }
  return diagnostics;
}

function hasExpectedPreviewDependency(
  record: VersionObjectRecord<MergeResolutionSetArtifactPayload>,
  resultDigest: ObjectDigest,
): boolean {
  const expectedResultDigest = toInternalSha256Digest(resultDigest);
  if (!expectedResultDigest || record.preimage.dependencies.length !== 1) return false;
  const expected = mergePreviewArtifactRef(expectedResultDigest);
  if (expected.kind !== 'object') return false;
  return isExpectedPreviewDependency(record.preimage.dependencies[0], expected);
}

function isExpectedPreviewDependency(
  actual: unknown,
  expected: ObjectDependencyRef,
): actual is ObjectDependencyRef {
  return (
    isObjectDependencyRef(actual) &&
    actual.objectType === expected.objectType &&
    digestsEqual(actual.digest, expected.digest)
  );
}

function isObjectDependencyRef(value: unknown): value is ObjectDependencyRef {
  return (
    isRecord(value) &&
    value.kind === 'object' &&
    typeof value.objectType === 'string' &&
    isVersionObjectDigest(value.digest)
  );
}
