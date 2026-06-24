import { expect, it } from '@jest/globals';

import {
  createMaterializerMergeFixture,
  MATERIALIZER_TARGET_REF,
} from './version-apply-merge-materializer-scenario-helpers';

export function describeCleanMaterializerMergeScenario(): void {
  it('creates a durable two-parent merge commit from real provider-backed workbook edits', async () => {
    const fixture = await createMaterializerMergeFixture({
      graphId: 'graph-1',
      branchName: 'scenario/incoming',
      baseEdits: [['A1', 'base']],
      oursEdits: [['B1', 'ours']],
      theirsEdits: [['C1', 'theirs']],
    });

    try {
      const { sourceWb, baseCommit, oursCommit, theirsCommit, expectedTargetHead } = fixture;
      const preview = await sourceWb.version.merge({
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: theirsCommit.id,
      });
      expect(preview).toMatchObject({
        ok: true,
        value: {
          status: 'clean',
          changes: expect.arrayContaining([
            expect.objectContaining({
              structural: expect.objectContaining({ entityId: expect.stringMatching(/!B1$/) }),
            }),
            expect.objectContaining({
              structural: expect.objectContaining({ entityId: expect.stringMatching(/!C1$/) }),
            }),
          ]),
        },
      });

      const applied = await sourceWb.version.applyMerge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
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
        mutationGuarantee: 'merge-commit-created',
        commitRef: {
          refName: MATERIALIZER_TARGET_REF,
          resolvedFrom: MATERIALIZER_TARGET_REF,
        },
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

      const sourceCheckoutMerged = await sourceWb.version.checkout({
        kind: 'commit',
        id: mergeCommitId,
      });
      if (!sourceCheckoutMerged.ok) {
        throw new Error(`expected source checkout success: ${sourceCheckoutMerged.error.code}`);
      }
      await expect(sourceWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(sourceWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(sourceWb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: 'theirs' });

      const mergedWb = await fixture.openMergedWorkbook();
      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: mergeCommitId,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(mergedWb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: 'theirs' });
    } finally {
      await fixture.cleanup();
    }
  });
}
