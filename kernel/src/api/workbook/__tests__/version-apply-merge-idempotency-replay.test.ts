import { jest } from '@jest/globals';

import type { VersionRefName } from '@mog-sdk/contracts/api';

import type { MergeVersionGraphInput } from '../../../document/version-store/graph-store';
import { intentIdForResolvedAttemptDigest } from '../../../document/version-store/merge-apply-intent-store';
import {
  AUTHOR,
  createAlternatePreview,
  createCleanReviewFixture,
  expectedResolvedAttempt,
  expectGraphWriteSuccess,
  graphBackedApplyMergeService,
  graphCommitContent,
  readTargetHeadCommitId,
  TARGET_REF,
  type CleanPreviewMetadata,
  type MergeCommitServiceInput,
} from './version-apply-merge-idempotency-stale-ordering-test-utils';

describe('WorkbookVersion public applyMerge idempotency replay', () => {
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
});
