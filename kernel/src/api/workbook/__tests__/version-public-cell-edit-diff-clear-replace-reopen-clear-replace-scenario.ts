import { expectedCellDiff } from './version/public-cell-edit-diff.helpers';
import type {
  PublicCellEditDiffCommit,
  PublicCellEditDiffHeadWithRevision,
  PublicCellEditDiffWorkbook,
} from './version-public-cell-edit-diff-clear-replace-reopen-types';

export async function commitClearReplacePublicCellEdits(options: {
  readonly wb: PublicCellEditDiffWorkbook;
  readonly committed: PublicCellEditDiffCommit;
  readonly committedHead: PublicCellEditDiffHeadWithRevision;
}): Promise<PublicCellEditDiffCommit> {
  const { wb, committed, committedHead } = options;

  await wb.activeSheet.clearData('A1:A2');
  await wb.activeSheet.clear('B1:B2', 'contents');
  await expect(wb.activeSheet.replaceAll('C1:D1', '0', '5')).resolves.toBe(2);

  const clearReplaceCommitResult = await wb.version.commit({
    expectedHead: {
      commitId: committedHead.id,
      revision: committedHead.refRevision,
    },
  });
  if (!clearReplaceCommitResult.ok) {
    throw new Error(
      `expected public clear/replace commit success: ${clearReplaceCommitResult.error.code}`,
    );
  }
  const clearReplaceCommitted = clearReplaceCommitResult.value;

  expect(clearReplaceCommitted.parents).toEqual([committed.id]);
  await expect(wb.version.getHead()).resolves.toMatchObject({
    ok: true,
    value: {
      id: clearReplaceCommitted.id,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
    },
  });

  const clearReplaceDiff = await wb.version.diff(committed.id, clearReplaceCommitted.id);
  expect(clearReplaceDiff).toMatchObject({
    ok: true,
    value: {
      order: 'semantic-change-order',
      limit: 50,
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
  if (!clearReplaceDiff.ok) {
    throw new Error(`expected public clear/replace diff success: ${clearReplaceDiff.error.code}`);
  }
  expect(clearReplaceDiff.value.items).toHaveLength(6);

  return clearReplaceCommitted;
}
