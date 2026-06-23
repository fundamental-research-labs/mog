import type { ObjectDigest as PublicObjectDigest } from '@mog-sdk/contracts/api';

import {
  createMergePreviewArtifactRecord,
  mergeResultIdForPreviewDigest,
} from '../../../document/version-store/merge-attempt-artifacts';
import type {
  CleanPreviewMetadata,
  CleanReviewFixture,
} from './version-apply-merge-idempotency-stale-ordering-helpers-core';
import { expectObjectPutSuccess } from './version-apply-merge-idempotency-stale-ordering-helpers-expectations';
import { mergeChange } from './version-apply-merge-idempotency-stale-ordering-helpers-fixture-merge-change';

export async function createAlternatePreview(
  fixture: CleanReviewFixture,
  changeId: string,
): Promise<CleanPreviewMetadata> {
  const previewRecord = await createMergePreviewArtifactRecord(fixture.namespace, {
    status: 'clean',
    base: fixture.baseCommitId,
    ours: fixture.oursCommitId,
    theirs: fixture.theirsCommitId,
    changes: [mergeChange(changeId)],
  });
  expectObjectPutSuccess(await fixture.graph.putObjects([previewRecord]));
  return {
    resultId: mergeResultIdForPreviewDigest(previewRecord.digest),
    resultDigest: previewRecord.digest as PublicObjectDigest,
    previewArtifactDigest: previewRecord.digest as PublicObjectDigest,
  };
}
