import {
  createCleanReviewFixture,
  graphBackedApplyMergeService,
  TARGET_REF,
} from './version-apply-merge-idempotency-stale-ordering-test-utils';

export function registerReplaySuccessfulApplyScenarios(): void {
  it('replays a successful apply with the same intent before stale-target rejection', async () => {
    const fixture = await createCleanReviewFixture(
      'terminal-replay-before-stale',
      graphBackedApplyMergeService,
    );

    const first = await fixture.version.applyMerge(
      {
        resultId: fixture.preview.resultId,
        resultDigest: fixture.preview.resultDigest,
        previewArtifactDigest: fixture.preview.previewArtifactDigest,
      },
      {
        targetRef: TARGET_REF,
        expectedTargetHead: fixture.expectedTargetHead,
      },
    );
    if (!first.ok) throw new Error(`expected first apply success: ${first.error.code}`);
    expect(first.value).toMatchObject({
      status: 'applied',
      base: fixture.baseCommitId,
      ours: fixture.oursCommitId,
      theirs: fixture.theirsCommitId,
      resultId: fixture.preview.resultId,
      resultDigest: fixture.preview.resultDigest,
      previewArtifactDigest: fixture.preview.previewArtifactDigest,
      targetRef: TARGET_REF,
      headBefore: fixture.oursCommitId,
      mutationGuarantee: 'merge-commit-created',
    });
    if (first.value.status !== 'applied') throw new Error('expected first apply to create merge');
    const mergeCommitId = first.value.commitRef.id;

    const repeated = await fixture.version.applyMerge(
      {
        resultId: fixture.preview.resultId,
        resultDigest: fixture.preview.resultDigest,
        previewArtifactDigest: fixture.preview.previewArtifactDigest,
      },
      {
        targetRef: TARGET_REF,
        expectedTargetHead: fixture.expectedTargetHead,
      },
    );
    if (!repeated.ok) throw new Error(`expected repeated apply success: ${repeated.error.code}`);
    expect(repeated.value).toMatchObject({
      status: 'alreadyApplied',
      base: fixture.baseCommitId,
      ours: fixture.oursCommitId,
      theirs: fixture.theirsCommitId,
      resultId: fixture.preview.resultId,
      resultDigest: fixture.preview.resultDigest,
      previewArtifactDigest: fixture.preview.previewArtifactDigest,
      targetRef: TARGET_REF,
      headBefore: fixture.oursCommitId,
      headAfter: mergeCommitId,
      commitRef: {
        id: mergeCommitId,
        refName: TARGET_REF,
        resolvedFrom: TARGET_REF,
      },
      changes: [],
      conflicts: [],
      resolutionCount: 0,
      mutationGuarantee: 'ref-not-mutated',
    });
  });
}
