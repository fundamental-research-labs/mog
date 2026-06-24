import { jest } from '@jest/globals';

import type { VersionRefName } from '@mog-sdk/contracts/api';

import type { MergeVersionGraphInput } from '../../../document/version-store/graph';
import { intentIdForResolvedAttemptDigest } from '../../../document/version-store/merge-apply-intent-store';
import {
  AUTHOR,
  createAlternatePreview,
  createCleanReviewFixture,
  expectedResolvedAttempt,
  expectGraphWriteSuccess,
  graphCommitContent,
  readTargetHeadCommitId,
  TARGET_REF,
  type CleanPreviewMetadata,
  type MergeCommitServiceInput,
} from './version-apply-merge-idempotency-stale-ordering-test-utils';

export function registerReplayDifferentPayloadScenarios(): void {
  it('blocks terminal replay for a different sealed payload without finalizing target refs', async () => {
    let alternatePreview: CleanPreviewMetadata | null = null;
    const mergeCommit = jest.fn<(input: MergeCommitServiceInput) => Promise<unknown>>();
    const fixture = await createCleanReviewFixture(
      'terminal-replay-different-payload',
      ({ graph, namespace }) => ({
        mergeCommit: mergeCommit.mockImplementation(async (input: MergeCommitServiceInput) => {
          if (!alternatePreview) throw new Error('alternate preview was not prepared');
          const branchName = 'scenario/terminal-replay-different-payload-provider';
          const branchRef = `refs/heads/${branchName}` as VersionRefName;
          const branch = await graph.createBranch({
            name: branchName,
            targetCommitId: input.ours,
            expectedAbsent: true,
            createdBy: AUTHOR,
          });
          if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);
          const merge = await graph.mergeCommit({
            ...(await graphCommitContent(namespace, 'provider-terminal-replay')),
            targetRef: branchRef,
            expectedHeadCommitId: input.ours,
            expectedTargetRefVersion: branch.branch.ref.refVersion,
            mergeParentCommitId: input.theirs,
            ...(input.resolvedMergeAttemptDigest
              ? { resolvedMergeAttemptDigest: input.resolvedMergeAttemptDigest }
              : {}),
          } satisfies MergeVersionGraphInput);
          expectGraphWriteSuccess(merge);
          return {
            status: 'alreadyApplied',
            resultId: alternatePreview.resultId,
            resultDigest: alternatePreview.resultDigest,
            previewArtifactDigest: alternatePreview.previewArtifactDigest,
            targetRef: input.targetRef,
            headBefore: input.ours,
            headAfter: merge.commit.id,
            commitRef: {
              id: merge.commit.id,
              refName: branchRef,
              resolvedFrom: branchRef,
              refRevision: merge.ref.revision,
            },
            diagnostics: [],
          };
        }),
      }),
    );
    alternatePreview = await createAlternatePreview(fixture, 'different-sealed-payload');

    const replay = await fixture.version.applyMerge(
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

    expect(replay.ok).toBe(false);
    if (replay.ok) throw new Error('expected mismatched replay to be blocked');
    expect(replay.error).toMatchObject({
      target: 'workbook.version.applyMerge',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'VERSION_INVALID_COMMIT_PAYLOAD',
          data: expect.objectContaining({ mutationGuarantee: 'ref-not-mutated' }),
        }),
      ]),
    });
    expect(mergeCommit).toHaveBeenCalledTimes(1);
    await expect(readTargetHeadCommitId(fixture)).resolves.toBe(fixture.oursCommitId);

    const attempt = await expectedResolvedAttempt(fixture, []);
    const store = await fixture.provider.openMergeApplyIntentStore(fixture.namespace);
    const read = await store.readByIntentId(
      intentIdForResolvedAttemptDigest(attempt.resolvedAttemptDigest),
    );
    expect(read).toMatchObject({
      status: 'found',
      record: { state: 'staging' },
    });
    if (read.status !== 'found') throw new Error('expected staged intent to remain readable');
    expect(read.record).not.toHaveProperty('terminal');
  });
}
