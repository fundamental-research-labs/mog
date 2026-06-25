import { expect } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import {
  INDEXEDDB_CLEAN_MERGE_REPLAY_TARGET_REF,
  type IndexedDbCleanMergeReplayArtifact,
} from './version-indexeddb-persisted-apply-clean-merge-artifact-reopen-replay-preview-artifact';

export async function applyPersistedCleanMergeArtifactAfterReopen(
  reopenedWb: Workbook,
  artifact: IndexedDbCleanMergeReplayArtifact,
) {
  const { oursCommit, theirsCommit, expectedTargetHead, preview } = artifact;
  const applied = await reopenedWb.version.applyMerge(
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
  if (!applied.ok) throw new Error(`expected persisted clean apply success: ${applied.error.code}`);
  expect(applied.value).toMatchObject({
    status: 'applied',
    ours: oursCommit.id,
    theirs: theirsCommit.id,
    resultId: preview.resultId,
    resultDigest: preview.resultDigest,
    previewArtifactDigest: preview.previewArtifactDigest,
    resolvedAttemptDigest: {
      algorithm: 'sha256',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
    targetRef: INDEXEDDB_CLEAN_MERGE_REPLAY_TARGET_REF,
    mutationGuarantee: 'merge-commit-created',
  });

  return {
    mergeCommitId: applied.value.commitRef.id,
    applied: applied.value,
  };
}

export type IndexedDbCleanMergeReplayAppliedArtifact = Awaited<
  ReturnType<typeof applyPersistedCleanMergeArtifactAfterReopen>
>;
