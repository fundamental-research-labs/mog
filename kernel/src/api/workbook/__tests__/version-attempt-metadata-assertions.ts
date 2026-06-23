import { expect } from '@jest/globals';
import type {
  VersionApplyMergeAttemptMetadata,
  VersionMergeAttemptMetadata,
} from '@mog-sdk/contracts/api';

import {
  COMMIT_A,
  COMMIT_B,
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  EXPECTED_MERGE_METADATA_KEYS,
  EXPECTED_TARGET_HEAD,
  RESULT_ID_C,
} from './version-attempt-metadata-setup';

export function expectNormalizedMergeMetadata(
  metadata: VersionMergeAttemptMetadata | null,
  source: Readonly<Record<string, unknown>>,
): void {
  expect(metadata).toEqual({
    previewArtifactDigest: DIGEST_A,
    resultDigest: DIGEST_A,
    resolutionSetDigest: DIGEST_B,
    resolvedAttemptDigest: DIGEST_C,
    attemptPersistence: 'persisted',
    attemptKind: 'applyable',
    resultId: RESULT_ID_C,
    expiresAt: '2026-06-23T12:00:00.000Z',
    targetRef: 'refs/heads/main',
    expectedTargetHead: EXPECTED_TARGET_HEAD,
    applicationPlanDigest: DIGEST_B,
    applyEligibilityDigest: DIGEST_C,
  });
  expect(Object.keys(metadata ?? {})).toEqual(EXPECTED_MERGE_METADATA_KEYS);
  expect(metadata?.previewArtifactDigest).not.toBe(source.previewArtifactDigest);
  expect(metadata).not.toHaveProperty('source');
  expect(metadata).not.toHaveProperty('operation');
  expect(metadata).not.toHaveProperty('sourcePayload');
  expect(metadata).not.toHaveProperty('operationPayload');
}

export function expectNormalizedApplyMetadata(
  metadata: VersionApplyMergeAttemptMetadata | null,
): void {
  expect(metadata).toEqual({
    resultId: RESULT_ID_C,
    previewArtifactDigest: DIGEST_A,
    resultDigest: DIGEST_B,
    resolutionSetDigest: DIGEST_B,
    resolvedAttemptDigest: DIGEST_C,
    targetRef: 'refs/heads/main',
    headBefore: COMMIT_A,
    headAfter: COMMIT_B,
    applicationPlanDigest: DIGEST_A,
  });
  expect(metadata).not.toHaveProperty('sourcePayload');
  expect(metadata).not.toHaveProperty('operationPayload');
}

export function expectAttemptMetadataRejected(metadata: unknown): void {
  expect(metadata).toBeNull();
}
