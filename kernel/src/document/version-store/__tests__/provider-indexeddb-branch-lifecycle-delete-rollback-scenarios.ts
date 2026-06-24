import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import {
  AUTHOR,
  DOCUMENT_SCOPE,
  createBranchFixture,
  lifecycleWithPersistRace,
  readRefRecord,
  updateRefRecord,
} from './provider-indexeddb-branch-lifecycle-test-utils';

export function registerIndexedDbBranchLifecycleDeleteRollbackScenarios(): void {
  it('rolls back delete when the provider ref row is stale at durable CAS', async () => {
    const { initialized, namespace, branch, concurrentCommitId } = await createBranchFixture(
      'graph-branch-delete-race',
    );
    const lifecycle = lifecycleWithPersistRace(namespace, () =>
      updateRefRecord(namespace, 'scenario/idb-race', (record) => ({
        ...record,
        targetCommitId: concurrentCommitId,
        refVersion: { kind: 'counter', value: '1' },
      })),
    );

    const deleted = await lifecycle.deleteBranch({
      name: 'scenario/idb-race',
      expectedHead: initialized.rootCommit.id,
      expectedRefVersion: branch.ref.refVersion,
      deletedBy: AUTHOR,
    });

    expect(deleted.ok).toBe(false);
    if (deleted.ok) throw new Error('expected delete conflict');
    expect(deleted.error.code).toBe('casConflict');
    expect(deleted.diagnostics[0]).toMatchObject({
      code: 'casConflict',
      details: { cause: 'expectedHeadMismatch' },
    });
    await expect(readRefRecord(namespace, 'scenario/idb-race')).resolves.toMatchObject({
      record: {
        state: 'live',
        targetCommitId: concurrentCommitId,
        refVersion: { kind: 'counter', value: '1' },
      },
    });
  });

  it('recovers persisted tombstone CAS metadata when delete loses durable CAS to a delete', async () => {
    const { initialized, namespace, branch } = await createBranchFixture(
      'graph-branch-delete-tombstone-race',
    );
    const lifecycle = lifecycleWithPersistRace(namespace, async () => {
      const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      try {
        const graph = await provider.openGraph(namespace);
        const concurrentDelete = await graph.deleteBranch({
          name: 'scenario/idb-race',
          expectedHead: initialized.rootCommit.id,
          expectedRefVersion: branch.ref.refVersion,
          deletedBy: AUTHOR,
          deleteReason: 'concurrent-delete',
        });
        expect(concurrentDelete).toMatchObject({
          ok: true,
          branch: {
            ref: {
              state: 'tombstone',
              previousRefIncarnationId: branch.ref.refIncarnationId,
              refVersion: { kind: 'counter', value: '1' },
            },
          },
        });
      } finally {
        await provider.close('test-teardown');
      }
    });

    const deleted = await lifecycle.deleteBranch({
      name: 'scenario/idb-race',
      expectedHead: initialized.rootCommit.id,
      expectedRefVersion: branch.ref.refVersion,
      deletedBy: AUTHOR,
      deleteReason: 'losing-delete',
    });

    expect(deleted.ok).toBe(false);
    if (deleted.ok) throw new Error('expected tombstone conflict');
    expect(deleted.error.code).toBe('refTombstoned');
    expect(deleted.conflict).toMatchObject({
      code: 'refTombstoned',
      tombstoneRefVersion: { kind: 'counter', value: '1' },
      previousRefIncarnationId: branch.ref.refIncarnationId,
    });
    expect(deleted.diagnostics[0]).toMatchObject({
      code: 'refTombstoned',
      refName: 'scenario/idb-race',
      commitId: initialized.rootCommit.id,
      refVersion: { kind: 'counter', value: '1' },
      tombstoneRefVersion: { kind: 'counter', value: '1' },
      previousRefIncarnationId: branch.ref.refIncarnationId,
    });
    await expect(readRefRecord(namespace, 'scenario/idb-race')).resolves.toMatchObject({
      record: {
        state: 'tombstone',
        previousTargetCommitId: initialized.rootCommit.id,
        previousProviderRefId: branch.ref.providerRefId,
        previousProviderEpoch: branch.ref.providerEpoch,
        previousRefIncarnationId: branch.ref.refIncarnationId,
        deleteReason: 'concurrent-delete',
        refVersion: { kind: 'counter', value: '1' },
      },
    });
  });
}
