import type { VersionMainRefName } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
  createInMemoryVersionGraphStoreFromSnapshot,
  type CommitVersionGraphInput,
  type InMemoryVersionGraphStoreSnapshot,
  type InitializeVersionGraphInput,
  type VersionGraphReadRefResult,
  type VersionGraphWriteResult,
} from '../graph-store';
import {
  createMergePreviewArtifactRecord,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  mergePreviewArtifactRef,
  resolvedMergeAttemptArtifactRef,
} from '../merge-attempt-artifacts';
import type { VersionDependencyRef, VersionObjectType, WorkbookCommitId } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { RefVersion } from '../ref-store';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-snapshot',
  documentId: 'document-snapshot',
  graphId: 'graph-snapshot',
  principalScope: 'principal-snapshot',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-snapshot',
  actorKind: 'user',
  displayName: 'Snapshot User',
};

function expectGraphSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

function expectReadRefSuccess(
  result: VersionGraphReadRefResult,
): asserts result is Extract<VersionGraphReadRefResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readRef success: ${result.diagnostics[0]?.code}`);
  }
}

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace = NAMESPACE,
  dependencies: readonly VersionDependencyRef[] = [],
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies,
    payload,
  });
}

async function graphInput(label: string): Promise<InitializeVersionGraphInput> {
  return {
    snapshotRootRecord: await objectRecord('workbook.snapshotRoot.v1', { label, sheets: [] }),
    semanticChangeSetRecord: await objectRecord('workbook.semanticChangeSet.v1', {
      label,
      changes: [],
    }),
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
}

function commitInput(
  input: InitializeVersionGraphInput,
  expectedHeadCommitId: WorkbookCommitId,
  expectedMainRefVersion: RefVersion,
): CommitVersionGraphInput {
  return {
    ...input,
    expectedHeadCommitId,
    expectedMainRefVersion,
    parentCommitIds: [expectedHeadCommitId],
  };
}

describe('InMemoryVersionGraphStore snapshots', () => {
  it('exports and reloads standalone artifacts, branches, tombstones, and symbolic HEAD', async () => {
    const fixture = await snapshotFixture();
    const reloaded = await createInMemoryVersionGraphStoreFromSnapshot(fixture.snapshot);

    const symbolic = await reloaded.readRef(VERSION_GRAPH_HEAD_REF);
    expectReadRefSuccess(symbolic);
    expect(symbolic.ref).toEqual({
      name: VERSION_GRAPH_HEAD_REF,
      target: VERSION_GRAPH_MAIN_REF,
      revision: fixture.mainCommit.main.revision,
    });

    await expect(reloaded.readBranch('scenario/live-snapshot')).resolves.toMatchObject({
      ok: true,
      branch: {
        refName: 'refs/heads/scenario%2Flive-snapshot',
        ref: {
          targetCommitId: fixture.liveCommit.commit.id,
          refVersion: { kind: 'counter', value: '1' },
        },
      },
    });
    const tombstone = reloaded.refStore.getRef('scenario/deleted-snapshot', {
      includeTombstone: true,
    });
    expect(tombstone).toMatchObject({
      ok: true,
      ref: {
        state: 'tombstone',
        previousTargetCommitId: fixture.deletedCommit.commit.id,
        deleteReason: 'snapshot-test',
      },
    });

    await expect(reloaded.getObjectRecord(mergePreviewArtifactRef(fixture.preview.digest))).resolves
      .toMatchObject({
        preimage: {
          objectType: 'workbook.mergePreview.v1',
          dependencies: expect.arrayContaining([
            expect.objectContaining({ kind: 'commit', commitId: fixture.mainCommit.commit.id }),
            expect.objectContaining({ kind: 'commit', commitId: fixture.liveCommit.commit.id }),
          ]),
        },
      });
    await expect(
      reloaded.getObjectRecord(resolvedMergeAttemptArtifactRef(fixture.resolved.digest)),
    ).resolves.toMatchObject({
      preimage: {
        objectType: 'workbook.resolvedMergeAttempt.v1',
        dependencies: expect.arrayContaining([
          expect.objectContaining({
            kind: 'object',
            objectType: 'workbook.mergePreview.v1',
            digest: fixture.preview.digest,
          }),
          expect.objectContaining({
            kind: 'object',
            objectType: 'workbook.mergeResolutionSet.v1',
            digest: fixture.resolutionSet.digest,
          }),
        ]),
      },
    });

    expect(fixture.snapshot.refStore.liveRefCount).toBe(2);
    const previousGeneratedIds = new Set(
      fixture.snapshot.refStore.records.flatMap((record) =>
        record.state === 'live'
          ? [record.providerRefId, record.refIncarnationId]
          : [record.previousProviderRefId, record.previousRefIncarnationId],
      ),
    );
    const afterReloadBranch = await reloaded.createBranch({
      name: 'scenario/after-reload',
      targetCommitId: fixture.mainCommit.commit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(afterReloadBranch.ok).toBe(true);
    if (!afterReloadBranch.ok) throw new Error('expected after-reload branch create success');
    expect(previousGeneratedIds.has(afterReloadBranch.branch.ref.providerRefId)).toBe(false);
    expect(previousGeneratedIds.has(afterReloadBranch.branch.ref.refIncarnationId)).toBe(false);
  });

  it('rejects snapshots with missing standalone object dependencies', async () => {
    const fixture = await snapshotFixture();
    const missingResolutionSet = withoutDigest(
      fixture.snapshot,
      fixture.resolutionSet.digest.digest,
    );

    await expect(createInMemoryVersionGraphStoreFromSnapshot(missingResolutionSet)).rejects
      .toThrow('Version graph object snapshot failed validation.');
  });

  it('rejects stale branch manifest counters before rebuilding refs', async () => {
    const fixture = await snapshotFixture();

    await expect(
      createInMemoryVersionGraphStoreFromSnapshot({
        ...fixture.snapshot,
        refStore: {
          ...fixture.snapshot.refStore,
          liveRefCount: (fixture.snapshot.refStore.liveRefCount ?? 0) + 1,
        },
      }),
    ).rejects.toThrow('Version graph ref snapshot live ref count manifest is stale.');

    await expect(
      createInMemoryVersionGraphStoreFromSnapshot({
        ...fixture.snapshot,
        refStore: {
          ...fixture.snapshot.refStore,
          nextGeneratedId: 0,
        },
      }),
    ).rejects.toThrow('Version graph ref snapshot generated id manifest is stale.');
  });

  it('rejects snapshots whose tombstone refs point at missing commit objects', async () => {
    const fixture = await snapshotFixture();
    const missingDeletedBranchCommit = withoutDigest(
      fixture.snapshot,
      fixture.deletedCommit.commit.record.digest.digest,
    );

    await expect(createInMemoryVersionGraphStoreFromSnapshot(missingDeletedBranchCommit)).rejects
      .toThrow('Version graph ref snapshot references an unreadable commit object.');
  });
});

async function snapshotFixture() {
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

function withoutDigest(
  snapshot: InMemoryVersionGraphStoreSnapshot,
  digest: string,
): InMemoryVersionGraphStoreSnapshot {
  return {
    ...snapshot,
    objectRecords: snapshot.objectRecords.filter((record) => record.digest.digest !== digest),
  };
}
