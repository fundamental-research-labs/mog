import { expect, it } from '@jest/globals';

import {
  createMaterializerMergeFixture,
  MATERIALIZER_TARGET_REF,
  resolutionFor,
} from './version-apply-merge-materializer-scenario-helpers';

export function describeResolvedConflictMaterializerMergeScenario(): void {
  it('creates a durable merge commit for a resolved same-cell conflict', async () => {
    const fixture = await createMaterializerMergeFixture({
      graphId: 'graph-conflict',
      branchName: 'scenario/conflict-incoming',
      baseEdits: [['A1', 'base']],
      oursEdits: [['A1', 'ours']],
      theirsEdits: [['A1', 'theirs']],
    });

    try {
      const { sourceWb, baseCommit, oursCommit, theirsCommit, expectedTargetHead } = fixture;
      const preview = await sourceWb.version.merge({
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: theirsCommit.id,
      });
      if (!preview.ok) {
        throw new Error(`expected merge preview success: ${preview.error.code}`);
      }
      if (preview.value.status !== 'conflicted') {
        throw new Error(`expected conflicted merge preview, got ${preview.value.status}`);
      }
      expect(preview.value.conflicts).toHaveLength(1);
      expect(preview.value.conflicts[0]).toMatchObject({
        conflictKind: 'same-property',
        structural: expect.objectContaining({ entityId: expect.stringMatching(/!A1$/) }),
        base: { kind: 'value', value: 'base' },
        ours: { kind: 'value', value: 'ours' },
        theirs: { kind: 'value', value: 'theirs' },
      });

      const applied = await sourceWb.version.applyMerge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
          resolutions: [resolutionFor(preview.value.conflicts[0], 'acceptTheirs')],
        },
        {
          targetRef: MATERIALIZER_TARGET_REF as any,
          expectedTargetHead,
        },
      );
      if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'applied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resolutionCount: 1,
        mutationGuarantee: 'merge-commit-created',
      });

      const mergeCommitId = applied.value.commitRef.id;
      await expect(sourceWb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expect.objectContaining({
              id: mergeCommitId,
              parents: [oursCommit.id, theirsCommit.id],
            }),
          ]),
        },
      });

      const mergedWb = await fixture.openMergedWorkbook();
      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: mergeCommitId,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'theirs',
      });
    } finally {
      await fixture.cleanup();
    }
  });
}
