import {
  idempotencyKeyForResolvedAttempt,
  intentIdForResolvedAttemptDigest,
} from '../../../document/version-store/merge-apply-intent-store';
import {
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
} from '../../../document/version-store/merge-attempt-artifacts';
import type { ObjectDigest } from '../../../document/version-store/object-digest';
import {
  createPersistedMergeScenario,
  PERSISTED_ARTIFACT_CREATED_AT,
  PERSISTED_ARTIFACT_TARGET_REF,
  resolutionFor,
} from './version-apply-merge-persisted-artifact-test-utils';

export function registerNoCommitBoundIdentityScenario(): void {
  it('does not recover a conflicted staged intent from parent shape without commit-bound resolved attempt identity', async () => {
    const fixture = await createPersistedMergeScenario({
      graphId: 'graph-conflict-no-identity',
      branchName: 'scenario/persisted-conflict-no-identity',
      ours: [{ cell: 'A1', value: 'ours' }],
      theirs: [{ cell: 'A1', value: 'theirs' }],
    });

    try {
      const { sourceWb, provider, namespace, baseCommit, oursCommit, theirsCommit } = fixture;
      const preview = await sourceWb.version.merge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          mode: 'preview',
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (
        !preview.ok ||
        preview.value.status !== 'conflicted' ||
        !preview.value.resultId ||
        !preview.value.resultDigest ||
        !preview.value.previewArtifactDigest
      ) {
        throw new Error('expected persisted conflicted preview metadata');
      }

      const resolution = resolutionFor(preview.value.conflicts[0], 'acceptTheirs');
      const graph = await provider.openGraph(namespace, provider.accessContext);
      const resolutionSet = await createMergeResolutionSetArtifactRecord(namespace, [resolution]);
      const resolvedAttempt = await createResolvedMergeAttemptArtifactRecord(namespace, {
        resultDigest: preview.value.resultDigest as ObjectDigest,
        resolutionSetDigest: resolutionSet.digest,
        targetRef: PERSISTED_ARTIFACT_TARGET_REF,
        expectedTargetHead: fixture.expectedTargetHead,
      });
      expect(await graph.putObjects([resolutionSet, resolvedAttempt])).toMatchObject({
        status: 'success',
      });
      const intentStore = await provider.openMergeApplyIntentStore(namespace);
      await expect(
        intentStore.beginIntent({
          intentId: intentIdForResolvedAttemptDigest(resolvedAttempt.digest),
          idempotencyKey: idempotencyKeyForResolvedAttempt({
            resolvedAttemptDigest: resolvedAttempt.digest,
            targetRef: PERSISTED_ARTIFACT_TARGET_REF,
            expectedTargetHead: fixture.expectedTargetHead,
          }),
          applyKind: 'mergeCommit',
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
          resultDigest: preview.value.resultDigest as ObjectDigest,
          resolutionSetDigest: resolutionSet.digest,
          resolvedAttemptDigest: resolvedAttempt.digest,
          createdAt: PERSISTED_ARTIFACT_CREATED_AT,
        }),
      ).resolves.toMatchObject({ status: 'created', record: { state: 'staging' } });

      const unboundApply = await sourceWb.version.applyMerge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
          resolutions: [resolution],
        },
        {
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
        },
      );
      if (!unboundApply.ok) {
        throw new Error(`expected unbound direct apply success: ${unboundApply.error.code}`);
      }
      const mergeCommitId = unboundApply.value.commitRef.id;
      await expect(graph.readCommit(mergeCommitId)).resolves.toMatchObject({
        status: 'success',
        commit: {
          payload: {
            parentCommitIds: [oursCommit.id, theirsCommit.id],
          },
        },
      });

      const recovered = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
          resolutions: [resolution],
        },
        {
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
        },
      );
      if (!recovered.ok) throw new Error(`expected stale replay result: ${recovered.error.code}`);
      expect(recovered.value).toMatchObject({
        status: 'staleTargetHead',
        headAfter: mergeCommitId,
        resolvedAttemptDigest: resolvedAttempt.digest,
        mutationGuarantee: 'ref-not-mutated',
      });
      await expect(
        intentStore.readByIntentId(intentIdForResolvedAttemptDigest(resolvedAttempt.digest)),
      ).resolves.toMatchObject({
        status: 'found',
        record: { state: 'staging' },
      });
    } finally {
      await fixture.cleanup();
    }
  });
}
