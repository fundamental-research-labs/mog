import { expectedCellDiff } from './version/public-cell-edit-diff.helpers';
import type {
  PublicCellEditDiffCommit,
  PublicCellEditDiffInitializedGraph,
  PublicCellEditDiffWorkbook,
} from './version-public-cell-edit-diff-clear-replace-reopen-types';

export async function verifyPublicCellEditDiffAfterReopen(options: {
  readonly reopenedWb: PublicCellEditDiffWorkbook;
  readonly initialized: PublicCellEditDiffInitializedGraph;
  readonly committed: PublicCellEditDiffCommit;
  readonly clearReplaceCommitted: PublicCellEditDiffCommit;
}): Promise<void> {
  const { reopenedWb, initialized, committed, clearReplaceCommitted } = options;

  await expect(reopenedWb.version.getHead()).resolves.toMatchObject({
    ok: true,
    value: {
      id: clearReplaceCommitted.id,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
    },
  });
  await expect(reopenedWb.version.listCommits()).resolves.toMatchObject({
    ok: true,
    value: {
      items: expect.arrayContaining([
        expect.objectContaining({ id: clearReplaceCommitted.id }),
        expect.objectContaining({ id: committed.id }),
        expect.objectContaining({ id: initialized.rootCommit.id }),
      ]),
    },
  });
  await expect(
    reopenedWb.version.diff(initialized.rootCommit.id, committed.id),
  ).resolves.toMatchObject({
    ok: true,
    value: {
      items: expect.arrayContaining([
        expectedCellDiff('A1', 42),
        expectedCellDiff('A2', { kind: 'formula', formula: '=A1+1', result: 43 }),
        expectedCellDiff('B1', 7),
        expectedCellDiff('B2', { kind: 'formula', formula: '=B1+5', result: 12 }),
        expectedCellDiff('C1', 10),
        expectedCellDiff('D1', 20),
        expectedCellDiff('C2', { kind: 'formula', formula: '=C1+1', result: 11 }),
        expectedCellDiff('D2', { kind: 'formula', formula: '=D1+1', result: 21 }),
      ]),
    },
  });
  await expect(
    reopenedWb.version.diff(committed.id, clearReplaceCommitted.id),
  ).resolves.toMatchObject({
    ok: true,
    value: {
      items: expect.arrayContaining([
        expectedCellDiff('A1', null),
        expectedCellDiff('A2', null),
        expectedCellDiff('B1', null),
        expectedCellDiff('B2', null),
        expectedCellDiff('C1', 15),
        expectedCellDiff('D1', 25),
      ]),
    },
  });
}
