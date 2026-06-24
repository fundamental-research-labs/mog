import type { VersionMainRefName } from '@mog-sdk/contracts/api';

import { VERSION_GRAPH_MAIN_REF, createInMemoryVersionGraphStore } from '../graph';
import {
  createMergePreviewArtifactRecord,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
} from '../merge-attempt-artifacts';
import { AUTHOR, NAMESPACE } from './graph-store-snapshot-test-helpers-constants';
import { expectGraphSuccess } from './graph-store-snapshot-test-helpers-expectations';
import { commitInput, graphInput } from './graph-store-snapshot-test-helpers-inputs';

export async function snapshotFixture() {
  const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
  const initialized = await graph.initializeGraph(await graphInput('root'));
  expectGraphSuccess(initialized);

  const mainCommit = await graph.commit(
    commitInput(await graphInput('main-child'), initialized.commit.id, initialized.main.revision),
  );
  expectGraphSuccess(mainCommit);

  const liveBranch = await graph.createBranch({
    name: 'scenario/live-snapshot',
    targetCommitId: initialized.commit.id,
    expectedAbsent: true,
    createdBy: AUTHOR,
  });
  expect(liveBranch.ok).toBe(true);
  if (!liveBranch.ok) throw new Error('expected live branch create success');
  const liveCommit = await graph.commit({
    ...(await graphInput('live-branch-child')),
    targetRef: 'refs/heads/scenario/live-snapshot',
    expectedHeadCommitId: initialized.commit.id,
    expectedTargetRefVersion: liveBranch.branch.ref.refVersion,
    parentCommitIds: [initialized.commit.id],
  });
  expectGraphSuccess(liveCommit);

  const deletedBranch = await graph.createBranch({
    name: 'scenario/deleted-snapshot',
    targetCommitId: initialized.commit.id,
    expectedAbsent: true,
    createdBy: AUTHOR,
  });
  expect(deletedBranch.ok).toBe(true);
  if (!deletedBranch.ok) throw new Error('expected deleted branch create success');
  const deletedCommit = await graph.commit({
    ...(await graphInput('deleted-branch-child')),
    targetRef: 'refs/heads/scenario/deleted-snapshot',
    expectedHeadCommitId: initialized.commit.id,
    expectedTargetRefVersion: deletedBranch.branch.ref.refVersion,
    parentCommitIds: [initialized.commit.id],
  });
  expectGraphSuccess(deletedCommit);
  await expect(
    graph.deleteBranch({
      name: 'scenario/deleted-snapshot',
      expectedHead: deletedCommit.commit.id,
      expectedRefVersion: deletedCommit.ref.revision,
      deletedBy: AUTHOR,
      deleteReason: 'snapshot-test',
    }),
  ).resolves.toMatchObject({ ok: true });

  const preview = await createMergePreviewArtifactRecord(NAMESPACE, {
    status: 'clean',
    base: initialized.commit.id,
    ours: mainCommit.commit.id,
    theirs: liveCommit.commit.id,
  });
  const resolutionSet = await createMergeResolutionSetArtifactRecord(NAMESPACE);
  const resolved = await createResolvedMergeAttemptArtifactRecord(NAMESPACE, {
    resultDigest: preview.digest,
    resolutionSetDigest: resolutionSet.digest,
    targetRef: VERSION_GRAPH_MAIN_REF as VersionMainRefName,
    expectedTargetHead: {
      commitId: mainCommit.commit.id,
      revision: mainCommit.main.revision,
    },
  });
  await expect(graph.putObjects([resolved, resolutionSet, preview])).resolves.toMatchObject({
    status: 'success',
  });

  const snapshot = await graph.exportSnapshot();
  return {
    graph,
    initialized,
    mainCommit,
    liveCommit,
    deletedCommit,
    preview,
    resolutionSet,
    resolved,
    snapshot,
  };
}
