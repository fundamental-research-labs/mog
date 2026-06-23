import { it } from '@jest/globals';

import { applyPersistedCleanMergeArtifactAfterReopen } from './version-indexeddb-persisted-apply-clean-merge-artifact-reopen-replay-apply';
import { createPersistedCleanMergeReplayArtifact } from './version-indexeddb-persisted-apply-clean-merge-artifact-reopen-replay-preview-artifact';
import {
  replayFinalizedPersistedCleanMergeIntent,
  verifyPersistedCleanMergeCheckout,
} from './version-indexeddb-persisted-apply-clean-merge-artifact-reopen-replay-replay';
import {
  createIndexedDbCleanMergeReplayHandle,
  openIndexedDbCleanMergeReplayWorkbook,
  openInitializedIndexedDbCleanMergeReplayWorkbook,
  type IndexedDbCleanMergeReplayHandle,
  type IndexedDbCleanMergeReplayWorkbook,
} from './version-indexeddb-persisted-apply-clean-merge-artifact-reopen-replay-workbooks';

export function registerIndexedDbPersistedApplyCleanMergeArtifactReopenReplayScenario(): void {
  it('applies a persisted clean merge artifact after reopen and replays the finalized merge intent', async () => {
    const firstHandle = await createIndexedDbCleanMergeReplayHandle();
    const branchHandle = await createIndexedDbCleanMergeReplayHandle();
    let firstWb: IndexedDbCleanMergeReplayWorkbook | undefined;
    let branchWb: IndexedDbCleanMergeReplayWorkbook | undefined;
    let reopenedHandle: IndexedDbCleanMergeReplayHandle | undefined;
    let reopenedWb: IndexedDbCleanMergeReplayWorkbook | undefined;
    let secondReopenedHandle: IndexedDbCleanMergeReplayHandle | undefined;
    let secondReopenedWb: IndexedDbCleanMergeReplayWorkbook | undefined;
    let checkoutHandle: IndexedDbCleanMergeReplayHandle | undefined;
    let checkoutWb: IndexedDbCleanMergeReplayWorkbook | undefined;

    try {
      firstWb = await openInitializedIndexedDbCleanMergeReplayWorkbook(firstHandle);
      branchWb = await openIndexedDbCleanMergeReplayWorkbook(branchHandle);
      const artifact = await createPersistedCleanMergeReplayArtifact(firstWb, branchWb);

      await branchWb.close('skipSave');
      branchWb = undefined;
      await branchHandle.dispose();
      await firstWb.close('skipSave');
      firstWb = undefined;
      await firstHandle.dispose();

      reopenedHandle = await createIndexedDbCleanMergeReplayHandle();
      reopenedWb = await openIndexedDbCleanMergeReplayWorkbook(reopenedHandle);
      const appliedArtifact = await applyPersistedCleanMergeArtifactAfterReopen(
        reopenedWb,
        artifact,
      );

      await reopenedWb.close('skipSave');
      reopenedWb = undefined;
      await reopenedHandle.dispose();

      secondReopenedHandle = await createIndexedDbCleanMergeReplayHandle();
      secondReopenedWb = await openIndexedDbCleanMergeReplayWorkbook(secondReopenedHandle);
      await replayFinalizedPersistedCleanMergeIntent(secondReopenedWb, artifact, appliedArtifact);

      checkoutHandle = await createIndexedDbCleanMergeReplayHandle();
      checkoutWb = await openIndexedDbCleanMergeReplayWorkbook(checkoutHandle);
      await verifyPersistedCleanMergeCheckout(checkoutWb, appliedArtifact.mergeCommitId);
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (checkoutHandle) await checkoutHandle.dispose();
      if (secondReopenedWb) await secondReopenedWb.close('skipSave');
      if (secondReopenedHandle) await secondReopenedHandle.dispose();
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      if (branchWb) await branchWb.close('skipSave');
      await branchHandle.dispose();
      if (firstWb) await firstWb.close('skipSave');
      await firstHandle.dispose();
    }
  });
}
