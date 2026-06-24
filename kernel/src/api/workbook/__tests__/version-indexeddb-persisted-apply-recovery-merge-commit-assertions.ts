import { expect } from '@jest/globals';

import type { VersionApplyMergeResult } from '@mog-sdk/contracts/api';

import type { IndexedDbVersionStoreProvider } from '../../../document/version-store/provider-indexeddb/backend';
import { intentIdForResolvedAttemptDigest } from './version-indexeddb-persisted-apply-recovery-test-utils';
import type { MergeCommitRecoveryStage } from './version-indexeddb-persisted-apply-recovery-merge-commit-types';

export async function expectRecoveredMergeCommitAlreadyApplied(
  provider: IndexedDbVersionStoreProvider,
  recovered: VersionApplyMergeResult,
  stage: MergeCommitRecoveryStage,
): Promise<void> {
  expect(recovered).toMatchObject({
    status: 'alreadyApplied',
    commitRef: {
      id: stage.mergeCommitId,
      refName: 'refs/heads/main',
      resolvedFrom: 'refs/heads/main',
    },
    resultId: stage.preview.resultId,
    resultDigest: stage.preview.resultDigest,
    previewArtifactDigest: stage.preview.previewArtifactDigest,
    resolvedAttemptDigest: stage.resolvedAttemptDigest,
    targetRef: 'refs/heads/main',
    headBefore: stage.oursCommitId,
    headAfter: stage.mergeCommitId,
    mutationGuarantee: 'ref-not-mutated',
  });

  const finalizedStore = await provider.openMergeApplyIntentStore(stage.namespace);
  await expect(
    finalizedStore.readByIntentId(intentIdForResolvedAttemptDigest(stage.resolvedAttemptDigest)),
  ).resolves.toMatchObject({
    status: 'found',
    record: {
      state: 'finalized',
      terminal: {
        status: 'applied',
        headBefore: stage.oursCommitId,
        headAfter: stage.mergeCommitId,
        commitId: stage.mergeCommitId,
        refCasProof: expect.objectContaining({ schemaVersion: 1, applyKind: 'mergeCommit' }),
      },
    },
  });
}
