import { it } from '@jest/globals';

import {
  mapVersionApplyMergeAttemptMetadata,
  mapVersionMergeAttemptMetadata,
} from '../version-attempt-metadata';
import {
  expectAttemptMetadataRejected,
  expectNormalizedApplyMetadata,
  expectNormalizedMergeMetadata,
} from './version-attempt-metadata-assertions';
import {
  createApplyMetadataSource,
  createMergeMetadataSource,
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  RESULT_ID_A,
  RESULT_ID_C,
} from './version-attempt-metadata-setup';

export function registerMergeMetadataNormalizationScenario(): void {
  it('normalizes merge metadata deterministically and redacts unsafe provider payloads', () => {
    const source = createMergeMetadataSource();
    const metadata = mapVersionMergeAttemptMetadata(source);

    expectNormalizedMergeMetadata(metadata, source);
  });
}

export function registerMergeMetadataShapeRejectionScenario(): void {
  it('rejects merge metadata with noncanonical or stale fields', () => {
    expectAttemptMetadataRejected(
      mapVersionMergeAttemptMetadata({
        resultId: 'merge-result:review-main',
        resultDigest: DIGEST_A,
      }),
    );
    expectAttemptMetadataRejected(
      mapVersionMergeAttemptMetadata({
        resultId: RESULT_ID_A,
        previewArtifactDigest: DIGEST_A,
        resultDigest: DIGEST_A,
        redactionPolicyDigest: DIGEST_B,
      }),
    );
    expectAttemptMetadataRejected(
      mapVersionMergeAttemptMetadata({
        resultId: RESULT_ID_A,
        previewArtifactDigest: DIGEST_A,
        resultDigest: DIGEST_A,
        mergePreviewArtifact: { digest: DIGEST_A },
      }),
    );
  });
}

export function registerMergeMetadataDigestClosureRejectionScenario(): void {
  it('rejects result ids that do not close over canonical digest metadata', () => {
    expectAttemptMetadataRejected(
      mapVersionMergeAttemptMetadata({
        resultId: RESULT_ID_A,
        resultDigest: DIGEST_A,
        resolvedAttemptDigest: DIGEST_C,
      }),
    );
    expectAttemptMetadataRejected(
      mapVersionMergeAttemptMetadata({
        resultId: RESULT_ID_C,
        previewArtifactDigest: DIGEST_A,
        resultDigest: DIGEST_A,
      }),
    );
  });
}

export function registerApplyMetadataNormalizationScenario(): void {
  it('normalizes apply metadata with the same redaction and closure guarantees', () => {
    const metadata = mapVersionApplyMergeAttemptMetadata(createApplyMetadataSource());

    expectNormalizedApplyMetadata(metadata);

    expectAttemptMetadataRejected(
      mapVersionApplyMergeAttemptMetadata({
        resultId: RESULT_ID_A,
        resolvedAttemptDigest: DIGEST_C,
      }),
    );
    expectAttemptMetadataRejected(
      mapVersionApplyMergeAttemptMetadata({
        resultId: RESULT_ID_A,
        resultDigest: DIGEST_A,
        applyPlanDigest: DIGEST_B,
      }),
    );
  });
}
