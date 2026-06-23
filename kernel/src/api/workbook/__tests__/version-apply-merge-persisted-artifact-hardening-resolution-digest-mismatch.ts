import {
  createMergeResolutionSetArtifactRecord,
  mergeResolutionSetArtifactRef,
} from '../../../document/version-store/merge-attempt-artifacts';
import {
  createPersistedMergeScenario,
  mutateDigest,
  PERSISTED_ARTIFACT_TARGET_REF,
  resolutionFor,
} from './version-apply-merge-persisted-artifact-test-utils';

export function registerResolutionDigestMismatchScenario(): void {
  it('rejects a mismatched artifact resolution digest before write services', async () => {
    let mergeCommitCallCount = 0;
    const fixture = await createPersistedMergeScenario({
      graphId: 'graph-conflict-resolution-digest-mismatch',
      branchName: 'scenario/persisted-resolution-digest-mismatch',
      ours: [{ cell: 'A1', value: 'ours' }],
      theirs: [{ cell: 'A1', value: 'theirs' }],
      applyMergeService: {
        mergeCommit: async () => {
          mergeCommitCallCount += 1;
        },
      },
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
      const expectedResolutionSet = await createMergeResolutionSetArtifactRecord(namespace, [
        resolution,
      ]);

      const rejected = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
          resolutionSetDigest: mutateDigest(expectedResolutionSet.digest),
          resolutions: [resolution],
        },
        {
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
        },
      );
      expect(rejected).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.applyMerge',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: 'VERSION_MERGE_RESOLUTION_MISMATCH',
              message: 'persisted merge resolutionSetDigest does not match the resolved artifact.',
              data: expect.objectContaining({
                redacted: true,
                mutationGuarantee: 'no-write-attempted',
              }),
            }),
          ]),
        },
      });
      expect(mergeCommitCallCount).toBe(0);

      const graph = await provider.openGraph(namespace, provider.accessContext);
      await expect(
        graph.hasObject(mergeResolutionSetArtifactRef(expectedResolutionSet.digest)),
      ).resolves.toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });
}
