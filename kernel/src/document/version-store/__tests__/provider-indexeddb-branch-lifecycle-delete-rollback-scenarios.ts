import {
  AUTHOR,
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
}
