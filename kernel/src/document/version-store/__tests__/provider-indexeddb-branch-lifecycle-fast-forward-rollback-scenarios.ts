import {
  AUTHOR,
  createBranchFixture,
  lifecycleWithPersistRace,
  readRefRecord,
  updateRefRecord,
} from './provider-indexeddb-branch-lifecycle-test-utils';

export function registerIndexedDbBranchLifecycleFastForwardRollbackScenarios(): void {
  it('rolls back fast-forward when the provider ref row is stale at durable CAS', async () => {
    const { initialized, namespace, branch, concurrentCommitId, rollbackCommitId } =
      await createBranchFixture('graph-branch-ff-race');
    const lifecycle = lifecycleWithPersistRace(namespace, () =>
      updateRefRecord(namespace, 'scenario/idb-race', (record) => ({
        ...record,
        targetCommitId: concurrentCommitId,
        refVersion: { kind: 'counter', value: '1' },
      })),
    );

    const advanced = await lifecycle.fastForwardBranch({
      name: 'scenario/idb-race',
      nextCommitId: rollbackCommitId,
      expectedOldCommitId: initialized.rootCommit.id,
      expectedRefVersion: branch.ref.refVersion,
      updatedBy: AUTHOR,
    });

    expect(advanced.ok).toBe(false);
    if (advanced.ok) throw new Error('expected fast-forward conflict');
    expect(advanced.error.code).toBe('casConflict');
    expect(advanced.diagnostics[0]).toMatchObject({
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
