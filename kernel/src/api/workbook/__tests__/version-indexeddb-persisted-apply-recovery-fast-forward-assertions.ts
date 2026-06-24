import { expect } from '@jest/globals';

import type { VersionApplyMergeResult } from '@mog-sdk/contracts/api';

import type { IndexedDbVersionStoreProvider } from '../../../document/version-store/provider-indexeddb/backend';
import type { FastForwardRecoveryStage } from './version-indexeddb-persisted-apply-recovery-fast-forward-types';

export async function expectRecoveredFastForwardAlreadyApplied(
  provider: IndexedDbVersionStoreProvider,
  recovered: VersionApplyMergeResult,
  stage: FastForwardRecoveryStage,
): Promise<void> {
  expect(recovered).toMatchObject({
    status: 'alreadyApplied',
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
    changes: [],
    resolutionCount: 0,
    mutationGuarantee: 'ref-not-mutated',
  });

  const finalizedStore = await provider.openMergeApplyIntentStore(stage.namespace);
  await expect(finalizedStore.readByIntentId(stage.intentId)).resolves.toMatchObject({
    status: 'found',
    record: {
      state: 'finalized',
      terminal: {
        status: 'fastForwarded',
        headBefore: stage.oursCommitId,
        headAfter: stage.theirsCommitId,
        commitId: stage.theirsCommitId,
      },
    },
  });
}
