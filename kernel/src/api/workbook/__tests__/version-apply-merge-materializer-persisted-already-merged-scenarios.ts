import { expect, it } from '@jest/globals';

import {
  createPersistedMaterializerSourceFixture,
  expectCommit,
  expectHead,
  expectPersistedPreviewMetadata,
  MATERIALIZER_TARGET_REF,
  requireRefRevision,
} from './version-apply-merge-materializer-persisted-test-utils';

export function describePersistedAlreadyMergedMaterializerScenarios(): void {
  it('applies a persisted already-merged result without moving the target ref', async () => {
    const fixture = await createPersistedMaterializerSourceFixture('graph-already-merged');

    try {
      const { sourceWb, initialized, baseCommit, oursCommit, expectedTargetHead } = fixture;

      const preview = await sourceWb.version.merge(
        {
          base: initialized.rootCommit.id,
          ours: oursCommit.id,
          theirs: baseCommit.id,
        },
        {
          mode: 'preview',
          targetRef: MATERIALIZER_TARGET_REF as any,
          expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (!preview.ok)
        throw new Error(`expected already-merged preview success: ${preview.error.code}`);
      expect(preview.value).toMatchObject({
        status: 'alreadyMerged',
        ours: oursCommit.id,
        theirs: baseCommit.id,
        resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
        resultDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        attemptPersistence: 'persisted',
        attemptKind: 'applyable',
        targetRef: MATERIALIZER_TARGET_REF,
      });
      const previewMetadata = expectPersistedPreviewMetadata(
        preview.value,
        'alreadyMerged',
        'expected already-merged preview to expose a persisted result id and digest',
      );

      const applied = await sourceWb.version.applyMerge(previewMetadata, {
        targetRef: MATERIALIZER_TARGET_REF as any,
        expectedTargetHead,
      });
      if (!applied.ok)
        throw new Error(`expected already-merged apply success: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'alreadyMerged',
        ours: oursCommit.id,
        theirs: baseCommit.id,
        commitRef: {
          id: oursCommit.id,
          refName: MATERIALIZER_TARGET_REF,
          resolvedFrom: MATERIALIZER_TARGET_REF,
        },
        resultId: previewMetadata.resultId,
        resultDigest: previewMetadata.resultDigest,
        targetRef: MATERIALIZER_TARGET_REF,
        headBefore: oursCommit.id,
        headAfter: oursCommit.id,
        changes: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-not-mutated',
      });

      const head = await expectHead(sourceWb);
      expect(head).toMatchObject({
        id: oursCommit.id,
        refRevision: expectedTargetHead.revision,
      });

      await sourceWb.activeSheet.setCell('C1', 'after-already-merged');
      const afterAlreadyMergedCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: oursCommit.id,
            revision: requireRefRevision(head),
          },
        }),
      );
      const staleTerminal = await sourceWb.version.applyMerge(previewMetadata, {
        targetRef: MATERIALIZER_TARGET_REF as any,
        expectedTargetHead,
      });
      if (!staleTerminal.ok) {
        throw new Error(
          `expected stale already-merged terminal result: ${staleTerminal.error.code}`,
        );
      }
      expect(staleTerminal.value).toMatchObject({
        status: 'staleTargetHead',
        ours: oursCommit.id,
        theirs: baseCommit.id,
        resultId: previewMetadata.resultId,
        resultDigest: previewMetadata.resultDigest,
        targetRef: MATERIALIZER_TARGET_REF,
        headBefore: oursCommit.id,
        headAfter: afterAlreadyMergedCommit.id,
        changes: [],
        mutationGuarantee: 'ref-not-mutated',
      });
    } finally {
      await fixture.cleanup();
    }
  });
}
