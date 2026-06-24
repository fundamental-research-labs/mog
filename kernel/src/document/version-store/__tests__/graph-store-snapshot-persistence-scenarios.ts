import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStoreFromSnapshot,
} from '../graph';
import {
  mergePreviewArtifactRef,
  resolvedMergeAttemptArtifactRef,
} from '../merge-attempt-artifacts';
import { AUTHOR, expectReadRefSuccess, snapshotFixture } from './graph-store-snapshot-test-helpers';

export function registerGraphStoreSnapshotPersistenceScenarios(): void {
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

    await expect(
      reloaded.getObjectRecord(mergePreviewArtifactRef(fixture.preview.digest)),
    ).resolves.toMatchObject({
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
}
