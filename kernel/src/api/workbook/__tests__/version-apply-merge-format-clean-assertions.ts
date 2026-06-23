import type { WorkbookCommitId } from '@mog-sdk/contracts/api';

import {
  FORMAT_CLEAN_TARGET_REF,
  type FormatCleanMergeFixture,
} from './version-apply-merge-format-clean-helpers';

export async function expectCleanSameCellFormatPreview(
  fixture: FormatCleanMergeFixture,
): Promise<void> {
  const { sourceWb, baseCommit, oursCommit, theirsCommit } = fixture;
  const preview = await sourceWb.version.merge({
    base: baseCommit.id,
    ours: oursCommit.id,
    theirs: theirsCommit.id,
  });
  if (!preview.ok) {
    throw new Error(`expected merge preview success: ${preview.error.code}`);
  }
  expect(preview.value).toMatchObject({
    status: 'clean',
    changes: [
      expect.objectContaining({
        structural: expect.objectContaining({
          entityId: expect.stringMatching(/!A1$/),
        }),
        merged: { kind: 'value', value: 'ours' },
      }),
      expect.objectContaining({
        structural: expect.objectContaining({
          domain: 'cells.formats.direct',
          entityId: expect.stringMatching(/!A1$/),
          propertyPath: ['format'],
        }),
      }),
    ],
    conflicts: [],
  });
}

export async function applyCleanSameCellFormatMerge(
  fixture: FormatCleanMergeFixture,
): Promise<WorkbookCommitId> {
  const { sourceWb, baseCommit, oursCommit, theirsCommit, expectedTargetHead } = fixture;
  const applied = await sourceWb.version.applyMerge(
    {
      base: baseCommit.id,
      ours: oursCommit.id,
      theirs: theirsCommit.id,
    },
    {
      targetRef: FORMAT_CLEAN_TARGET_REF as any,
      expectedTargetHead,
    },
  );
  if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
  expect(applied.value).toMatchObject({
    status: 'applied',
    ours: oursCommit.id,
    theirs: theirsCommit.id,
    resolutionCount: 0,
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
  return mergeCommitId;
}

export async function expectMergedCleanSameCellFormatWorkbook(
  fixture: FormatCleanMergeFixture,
  mergeCommitId: WorkbookCommitId,
): Promise<void> {
  const mergedWb = await fixture.openMergedWorkbook();
  const checkoutMerged = await mergedWb.version.checkout({
    kind: 'commit',
    id: mergeCommitId,
  });
  if (!checkoutMerged.ok) {
    throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
  }
  await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({
    value: 'ours',
    format: expect.objectContaining({ bold: true, fontColor: '#FF0000' }),
  });
  await expect(mergedWb.activeSheet.formats.get('A1')).resolves.toMatchObject({
    bold: true,
    fontColor: '#FF0000',
  });
  await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({
    value: 'base-seed',
  });
}
