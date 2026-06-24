import { alreadyMergedApplyMergeResult } from '../version/apply-merge/version-apply-merge-ancestry';
import { mapApplyMergeWriteResult } from '../version/apply-merge/write-result/version-apply-merge-write-result';
import {
  createAlternatePreview,
  createCleanReviewFixture,
  TARGET_REF,
} from './version-apply-merge-idempotency-stale-ordering-test-utils';

describe('WorkbookVersion public applyMerge idempotency write-result guards', () => {
  it('blocks alreadyMerged ancestry when expectedTargetHead does not match ours', async () => {
    const fixture = await createCleanReviewFixture('already-merged-ancestry-mismatch', () => ({}));

    const result = alreadyMergedApplyMergeResult({
      base: fixture.baseCommitId,
      ours: fixture.oursCommitId,
      theirs: fixture.theirsCommitId,
      targetRef: TARGET_REF,
      expectedTargetHead: {
        ...fixture.expectedTargetHead,
        commitId: fixture.theirsCommitId,
      },
    });

    expect(result).toMatchObject({
      status: 'blocked',
      base: fixture.baseCommitId,
      ours: fixture.oursCommitId,
      theirs: fixture.theirsCommitId,
      changes: [],
      conflicts: [],
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'expectedTargetHeadMismatch',
          }),
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
    });
  });

  it('blocks terminal write replay when sealed payload metadata differs from plan', async () => {
    const fixture = await createCleanReviewFixture('terminal-replay-payload-mismatch', () => ({}));
    const alternatePreview = await createAlternatePreview(fixture, 'mapper-payload-mismatch');

    const result = mapApplyMergeWriteResult(
      {
        status: 'alreadyApplied',
        resultId: alternatePreview.resultId,
        resultDigest: alternatePreview.resultDigest,
        previewArtifactDigest: alternatePreview.previewArtifactDigest,
        targetRef: TARGET_REF,
        headBefore: fixture.oursCommitId,
        headAfter: fixture.theirsCommitId,
        commitRef: {
          id: fixture.theirsCommitId,
          refName: TARGET_REF,
          resolvedFrom: TARGET_REF,
          refRevision: fixture.expectedTargetHead.revision,
        },
        diagnostics: [],
      },
      {
        base: fixture.baseCommitId,
        ours: fixture.oursCommitId,
        theirs: fixture.theirsCommitId,
        changes: [],
        resolutionCount: 0,
        targetRef: TARGET_REF,
        expectedTargetHead: fixture.expectedTargetHead,
        resultId: fixture.preview.resultId,
        resultDigest: fixture.preview.resultDigest,
        previewArtifactDigest: fixture.preview.previewArtifactDigest,
      },
      'merge-commit-created',
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: fixture.baseCommitId,
      ours: fixture.oursCommitId,
      theirs: fixture.theirsCommitId,
      changes: [],
      conflicts: [],
      mutationGuarantee: 'ref-not-mutated',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_INVALID_COMMIT_PAYLOAD',
          mutationGuarantee: 'ref-not-mutated',
        }),
      ]),
    });
  });

  it('blocks successful write results when echoed metadata differs from the staged plan', async () => {
    const fixture = await createCleanReviewFixture('success-payload-mismatch', () => ({}));
    const alternatePreview = await createAlternatePreview(fixture, 'success-payload-mismatch');

    const result = mapApplyMergeWriteResult(
      {
        status: 'success',
        resultId: alternatePreview.resultId,
        resultDigest: alternatePreview.resultDigest,
        previewArtifactDigest: alternatePreview.previewArtifactDigest,
        targetRef: TARGET_REF,
        headBefore: fixture.oursCommitId,
        headAfter: fixture.theirsCommitId,
        commitRef: {
          id: fixture.theirsCommitId,
          refName: TARGET_REF,
          resolvedFrom: TARGET_REF,
          refRevision: fixture.expectedTargetHead.revision,
        },
        diagnostics: [],
      },
      {
        base: fixture.baseCommitId,
        ours: fixture.oursCommitId,
        theirs: fixture.theirsCommitId,
        changes: [],
        resolutionCount: 0,
        targetRef: TARGET_REF,
        expectedTargetHead: fixture.expectedTargetHead,
        resultId: fixture.preview.resultId,
        resultDigest: fixture.preview.resultDigest,
        previewArtifactDigest: fixture.preview.previewArtifactDigest,
      },
      'merge-commit-created',
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: fixture.baseCommitId,
      ours: fixture.oursCommitId,
      theirs: fixture.theirsCommitId,
      resultId: fixture.preview.resultId,
      resultDigest: fixture.preview.resultDigest,
      previewArtifactDigest: fixture.preview.previewArtifactDigest,
      targetRef: TARGET_REF,
      headBefore: fixture.oursCommitId,
      headAfter: fixture.theirsCommitId,
      changes: [],
      conflicts: [],
      mutationGuarantee: 'unknown-after-crash',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_INVALID_COMMIT_PAYLOAD',
          mutationGuarantee: 'unknown-after-crash',
        }),
      ]),
    });
  });
});
