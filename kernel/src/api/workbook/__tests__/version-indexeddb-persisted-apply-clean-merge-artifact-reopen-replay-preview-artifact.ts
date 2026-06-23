import { expect } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import {
  expectCommit,
  expectHead,
  requireRefRevision,
} from './version-indexeddb-persisted-apply-test-helpers';

export const INDEXEDDB_CLEAN_MERGE_REPLAY_BRANCH = 'scenario/indexeddb-clean-artifact';
export const INDEXEDDB_CLEAN_MERGE_REPLAY_TARGET_REF = 'refs/heads/main';

export async function createPersistedCleanMergeReplayArtifact(
  firstWb: Workbook,
  branchWb: Workbook,
) {
  const rootHead = await expectHead(firstWb);

  await firstWb.activeSheet.setCell('A1', 'base');
  const baseCommit = await expectCommit(
    firstWb.version.commit({
      expectedHead: {
        commitId: rootHead.id,
        revision: requireRefRevision(rootHead),
      },
    }),
  );
  const baseHead = await expectHead(firstWb);

  const branch = await firstWb.version.createBranch({
    name: INDEXEDDB_CLEAN_MERGE_REPLAY_BRANCH as any,
    targetCommitId: baseCommit.id,
    expectedAbsent: true,
  });
  if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

  await firstWb.activeSheet.setCell('B1', 'ours');
  const oursCommit = await expectCommit(
    firstWb.version.commit({
      expectedHead: {
        commitId: baseCommit.id,
        revision: requireRefRevision(baseHead),
      },
    }),
  );
  const oursHead = await expectHead(firstWb);

  const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
  if (!checkoutBase.ok) {
    throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
  }
  await branchWb.activeSheet.setCell('C1', 'theirs');
  const theirsCommit = await expectCommit(
    branchWb.version.commit({
      targetRef: INDEXEDDB_CLEAN_MERGE_REPLAY_BRANCH as any,
      expectedHead: {
        commitId: baseCommit.id,
        revision: branch.value.revision,
      },
    }),
  );

  const expectedTargetHead = {
    commitId: oursCommit.id,
    revision: requireRefRevision(oursHead),
  };
  const preview = await firstWb.version.merge(
    {
      base: baseCommit.id,
      ours: oursCommit.id,
      theirs: theirsCommit.id,
    },
    {
      mode: 'preview',
      targetRef: INDEXEDDB_CLEAN_MERGE_REPLAY_TARGET_REF as any,
      expectedTargetHead,
      persistReviewRecord: true,
    },
  );
  if (!preview.ok)
    throw new Error(`expected persisted clean preview success: ${preview.error.code}`);
  expect(preview.value).toMatchObject({
    status: 'clean',
    resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
    resultDigest: {
      algorithm: 'sha256',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
    previewArtifactDigest: {
      algorithm: 'sha256',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
    attemptPersistence: 'persisted',
    attemptKind: 'reviewOnly',
  });
  if (
    preview.value.status !== 'clean' ||
    !preview.value.resultId ||
    !preview.value.resultDigest ||
    !preview.value.previewArtifactDigest
  ) {
    throw new Error('expected persisted clean preview to expose artifact metadata');
  }

  return {
    baseCommit,
    oursCommit,
    theirsCommit,
    expectedTargetHead,
    preview: preview.value,
  };
}

export type IndexedDbCleanMergeReplayArtifact = Awaited<
  ReturnType<typeof createPersistedCleanMergeReplayArtifact>
>;
