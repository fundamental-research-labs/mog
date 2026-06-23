import { expect } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import type { IndexedDbCleanMergeReplayAppliedArtifact } from './version-indexeddb-persisted-apply-clean-merge-artifact-reopen-replay-apply';
import {
  INDEXEDDB_CLEAN_MERGE_REPLAY_TARGET_REF,
  type IndexedDbCleanMergeReplayArtifact,
} from './version-indexeddb-persisted-apply-clean-merge-artifact-reopen-replay-preview-artifact';

export async function replayFinalizedPersistedCleanMergeIntent(
  secondReopenedWb: Workbook,
  artifact: IndexedDbCleanMergeReplayArtifact,
  appliedArtifact: IndexedDbCleanMergeReplayAppliedArtifact,
): Promise<void> {
  const { oursCommit, theirsCommit, expectedTargetHead, preview } = artifact;
  const { applied, mergeCommitId } = appliedArtifact;
  const repeated = await secondReopenedWb.version.applyMerge(
    {
      resultId: preview.resultId,
      resultDigest: preview.resultDigest,
      previewArtifactDigest: preview.previewArtifactDigest,
    },
    {
      targetRef: INDEXEDDB_CLEAN_MERGE_REPLAY_TARGET_REF as any,
      expectedTargetHead,
    },
  );
  if (!repeated.ok) {
    throw new Error(`expected persisted clean alreadyApplied success: ${repeated.error.code}`);
  }
  expect(repeated.value).toMatchObject({
    status: 'alreadyApplied',
    ours: oursCommit.id,
    theirs: theirsCommit.id,
    commitRef: {
      id: mergeCommitId,
      refName: INDEXEDDB_CLEAN_MERGE_REPLAY_TARGET_REF,
      resolvedFrom: INDEXEDDB_CLEAN_MERGE_REPLAY_TARGET_REF,
    },
    resultId: preview.resultId,
    resultDigest: preview.resultDigest,
    previewArtifactDigest: preview.previewArtifactDigest,
    resolvedAttemptDigest: applied.resolvedAttemptDigest,
    targetRef: INDEXEDDB_CLEAN_MERGE_REPLAY_TARGET_REF,
    headBefore: oursCommit.id,
    headAfter: mergeCommitId,
    mutationGuarantee: 'ref-not-mutated',
  });
}

export async function verifyPersistedCleanMergeCheckout(
  checkoutWb: Workbook,
  mergeCommitId: string,
): Promise<void> {
  const checkout = await checkoutWb.version.checkout({ kind: 'commit', id: mergeCommitId });
  if (!checkout.ok)
    throw new Error(`expected checkout after persisted merge apply: ${checkout.error.code}`);
  await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
  await expect(checkoutWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
  await expect(checkoutWb.activeSheet.getCell('C1')).resolves.toMatchObject({
    value: 'theirs',
  });
}
