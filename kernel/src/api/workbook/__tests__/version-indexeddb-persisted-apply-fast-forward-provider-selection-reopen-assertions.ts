import { expect } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import type { ProviderSelectionReopenFastForwardStage } from './version-indexeddb-persisted-apply-fast-forward-types';

const MAIN_REF = 'refs/heads/main' as any;

export async function expectPersistedFastForwardAppliesAfterReopen(
  workbook: Workbook,
  stage: ProviderSelectionReopenFastForwardStage,
): Promise<void> {
  const applied = await workbook.version.applyMerge(
    {
      resultId: stage.preview.resultId,
      resultDigest: stage.preview.resultDigest,
    },
    {
      targetRef: MAIN_REF,
      expectedTargetHead: stage.expectedTargetHead,
    },
  );
  if (!applied.ok)
    throw new Error(`expected persisted apply success after reopen: ${applied.error.code}`);
  expect(applied.value).toMatchObject({
    status: 'fastForwarded',
    ours: stage.oursCommitId,
    theirs: stage.theirsCommitId,
    commitRef: {
      id: stage.theirsCommitId,
      refName: 'refs/heads/main',
      resolvedFrom: 'refs/heads/main',
    },
    resultId: stage.preview.resultId,
    resultDigest: stage.preview.resultDigest,
    targetRef: 'refs/heads/main',
    headBefore: stage.oursCommitId,
    headAfter: stage.theirsCommitId,
    mutationGuarantee: 'ref-fast-forwarded',
  });
}

export async function expectFastForwardCheckoutCells(
  workbook: Workbook,
  stage: ProviderSelectionReopenFastForwardStage,
): Promise<void> {
  const checkout = await workbook.version.checkout({ kind: 'commit', id: stage.theirsCommitId });
  if (!checkout.ok)
    throw new Error(`expected checkout after persisted apply: ${checkout.error.code}`);
  await expect(workbook.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
  await expect(workbook.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
  await expect(workbook.activeSheet.getCell('C1')).resolves.toMatchObject({
    value: 'theirs',
  });
}
