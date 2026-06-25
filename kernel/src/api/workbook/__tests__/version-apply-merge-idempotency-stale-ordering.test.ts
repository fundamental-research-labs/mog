import { jest } from '@jest/globals';

import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import { mergeResolutionSetArtifactRef } from '../../../document/version-store/merge-attempt-artifacts';
import { intentIdForResolvedAttemptDigest } from '../../../document/version-store/merge-apply-intent-store';
import {
  commitGraph,
  createCleanReviewFixture,
  expectedResolvedAttempt,
  TARGET_REF,
} from './version-apply-merge-idempotency-stale-ordering-test-utils';

describe('WorkbookVersion public applyMerge stale ordering', () => {
  it('rejects a stale target ref before staging a new apply intent', async () => {
    const mergeCommit = jest.fn();
    const fixture = await createCleanReviewFixture('stale-before-new-intent', () => ({
      mergeCommit,
    }));

    const advanced = await commitGraph(fixture.graph, fixture.namespace, {
      label: 'advanced',
      targetRef: TARGET_REF,
      expectedHeadCommitId: fixture.oursCommitId,
      expectedTargetRefVersion: fixture.expectedTargetHead.revision,
      parentCommitIds: [fixture.oursCommitId],
    });

    const stale = await fixture.version.applyMerge(
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
    if (!stale.ok) throw new Error(`expected stale apply result success: ${stale.error.code}`);
    expect(stale.value).toMatchObject({
      status: 'staleTargetHead',
      base: fixture.baseCommitId,
      ours: fixture.oursCommitId,
      theirs: fixture.theirsCommitId,
      resultId: fixture.preview.resultId,
      resultDigest: fixture.preview.resultDigest,
      previewArtifactDigest: fixture.preview.previewArtifactDigest,
      targetRef: TARGET_REF,
      headBefore: fixture.oursCommitId,
      headAfter: advanced.commit.id,
      changes: [],
      conflicts: [],
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          mutationGuarantee: 'ref-not-mutated',
          payload: expect.objectContaining({
            reason: 'staleTargetHead',
            targetRef: TARGET_REF,
            expectedHead: fixture.oursCommitId,
            actualHead: advanced.commit.id,
          }),
        }),
      ],
      mutationGuarantee: 'ref-not-mutated',
    });
    expect(mergeCommit).not.toHaveBeenCalled();

    const attempt = await expectedResolvedAttempt(fixture, []);
    const store = await fixture.provider.openMergeApplyIntentStore(fixture.namespace);
    await expect(
      store.readByIntentId(intentIdForResolvedAttemptDigest(attempt.resolvedAttemptDigest)),
    ).resolves.toMatchObject({ status: 'missing' });
    await expect(
      fixture.graph.hasObject(mergeResolutionSetArtifactRef(attempt.resolutionSetDigest)),
    ).resolves.toBe(false);
  });

  it('binds staged apply intent metadata to targetRef and expectedHead', async () => {
    const mergeCommit = jest.fn(async () => ({
      status: 'blocked',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        {
          issueCode: 'VERSION_PROVIDER_FAILED',
          severity: 'error',
          recoverability: 'retry',
          messageTemplateId: 'version.applyMerge.injectedFailure',
          safeMessage: 'Injected applyMerge failure after staging.',
          redacted: true,
          mutationGuarantee: 'no-write-attempted',
        } satisfies VersionStoreDiagnostic,
      ],
    }));
    const fixture = await createCleanReviewFixture('staged-intent-metadata', () => ({
      mergeCommit,
    }));

    const stopped = await fixture.version.applyMerge(
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
    expect(stopped).toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.applyMerge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PROVIDER_FAILED',
            data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
          }),
        ],
      },
    });
    expect(mergeCommit).toHaveBeenCalledTimes(1);

    const attempt = await expectedResolvedAttempt(fixture, []);
    expect(mergeCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetRef: TARGET_REF,
        expectedTargetHead: fixture.expectedTargetHead,
        resolvedMergeAttemptDigest: attempt.resolvedAttemptDigest,
      }),
    );

    const store = await fixture.provider.openMergeApplyIntentStore(fixture.namespace);
    const read = await store.readByIntentId(
      intentIdForResolvedAttemptDigest(attempt.resolvedAttemptDigest),
    );
    expect(read).toMatchObject({
      status: 'found',
      record: {
        state: 'staging',
        applyKind: 'mergeCommit',
        base: fixture.baseCommitId,
        ours: fixture.oursCommitId,
        theirs: fixture.theirsCommitId,
        targetRef: TARGET_REF,
        expectedTargetHead: fixture.expectedTargetHead,
        resultDigest: fixture.preview.resultDigest,
        resolutionSetDigest: attempt.resolutionSetDigest,
        resolvedAttemptDigest: attempt.resolvedAttemptDigest,
        idempotencyKey: attempt.idempotencyKey,
      },
    });
  });
});
