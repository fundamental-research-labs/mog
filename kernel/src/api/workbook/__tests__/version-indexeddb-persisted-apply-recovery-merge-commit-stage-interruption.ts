import { expect } from '@jest/globals';

import type { VersionGraphNamespace } from '../../../document/version-store/object-store';
import type { IndexedDbVersionStoreProvider } from '../../../document/version-store/provider-indexeddb/backend';
import type { Workbook } from './version-indexeddb-persisted-apply-recovery-test-utils';
import type { MergeCommitRecoveryStage } from './version-indexeddb-persisted-apply-recovery-merge-commit-types';
import {
  MAIN_REF,
  type PersistedConflictedMergePreviewStage,
} from './version-indexeddb-persisted-apply-recovery-merge-commit-stage-preview';

export type InterruptedResolvedMergeCommitStage = Pick<
  MergeCommitRecoveryStage,
  'mergeCommitId' | 'resolvedAttemptDigest'
>;

export async function applyInterruptedResolvedMergeCommit({
  provider,
  namespace,
  workbook,
  previewStage,
}: {
  readonly provider: IndexedDbVersionStoreProvider;
  readonly namespace: VersionGraphNamespace;
  readonly workbook: Workbook;
  readonly previewStage: PersistedConflictedMergePreviewStage;
}): Promise<InterruptedResolvedMergeCommitStage> {
  const { preview, resolution, expectedTargetHead, oursCommitId, theirsCommitId } = previewStage;
  const interrupted = await workbook.version.applyMerge(
    {
      resultId: preview.resultId,
      resultDigest: preview.resultDigest,
      previewArtifactDigest: preview.previewArtifactDigest,
      resolutions: [resolution],
    },
    {
      targetRef: MAIN_REF,
      expectedTargetHead,
    },
  );
  expect(interrupted).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.applyMerge',
    },
  });

  const graph = await provider.openGraph(namespace, provider.accessContext);
  const currentRef = await graph.readRef(MAIN_REF);
  expect(currentRef).toMatchObject({ status: 'success' });
  if (currentRef.status !== 'success' || !('commitId' in currentRef.ref)) {
    throw new Error('expected main ref to point at interrupted merge commit');
  }
  const mergeCommitId = currentRef.ref.commitId;
  const interruptedCommit = await graph.readCommit(mergeCommitId);
  expect(interruptedCommit).toMatchObject({
    status: 'success',
    commit: {
      payload: {
        parentCommitIds: [oursCommitId, theirsCommitId],
        resolvedMergeAttemptDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      },
    },
  });
  if (interruptedCommit.status !== 'success') {
    throw new Error(
      `expected interrupted merge commit read: ${interruptedCommit.diagnostics[0]?.code}`,
    );
  }
  const resolvedAttemptDigest = interruptedCommit.commit.payload.resolvedMergeAttemptDigest;
  if (!resolvedAttemptDigest) throw new Error('expected merge commit attempt digest');

  return {
    mergeCommitId,
    resolvedAttemptDigest,
  };
}
