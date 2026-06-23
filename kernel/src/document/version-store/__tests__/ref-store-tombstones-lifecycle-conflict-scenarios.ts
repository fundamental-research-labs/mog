import {
  AUTHOR,
  COMMIT_A,
  COMMIT_B,
  createStore,
  expectCreateOk,
  expectDeleteOk,
  expectGetFailed,
  expectListOk,
  expectMutationOk,
  refVersion,
} from './ref-store-test-helpers';

export const registerRefStoreTombstoneConflictScenarios = (): void => {
  it('returns tombstone conflicts from getRef and rejects ordinary create over tombstone', () => {
    const store = createStore([
      '2026-06-20T00:00:00.000Z',
      '2026-06-20T00:00:01.000Z',
      '2026-06-20T00:00:02.000Z',
    ]);
    expectMutationOk(store.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR }));

    const created = store.createBranch({
      name: 'scenario/delete-me',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expectCreateOk(created);

    const deleted = store.deleteRef({
      name: 'scenario/delete-me',
      expectedHead: COMMIT_A,
      expectedRefVersion: created.ref.refVersion,
      deletedBy: AUTHOR,
      deleteReason: 'test cleanup',
    });
    expectDeleteOk(deleted);
    expect(deleted.ref).toMatchObject({
      state: 'tombstone',
      name: 'scenario/delete-me',
      previousTargetCommitId: COMMIT_A,
      previousRefIncarnationId: created.ref.refIncarnationId,
      refVersion: refVersion('1'),
      deletedAt: '2026-06-20T00:00:02.000Z',
    });

    const getDeleted = store.getRef('scenario/delete-me');
    expectGetFailed(getDeleted);
    expect(getDeleted.error.code).toBe('refTombstoned');
    expect(getDeleted.conflict).toEqual({
      code: 'refTombstoned',
      tombstoneRefVersion: refVersion('1'),
      previousRefIncarnationId: created.ref.refIncarnationId,
    });

    const explicitDeleted = store.getRef('scenario/delete-me', { includeTombstone: true });
    expect(explicitDeleted.ok).toBe(true);
    if (!explicitDeleted.ok) {
      throw new Error(`expected tombstone read: ${explicitDeleted.error.code}`);
    }
    expect(explicitDeleted.ref).toMatchObject({
      state: 'tombstone',
      name: 'scenario/delete-me',
      previousRefIncarnationId: created.ref.refIncarnationId,
    });

    const recreate = store.createBranch({
      name: 'scenario/delete-me',
      targetCommitId: COMMIT_B,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(recreate.ok).toBe(false);
    if (recreate.ok) throw new Error('expected create over tombstone to fail');
    expect(recreate.error.code).toBe('refTombstoned');

    const liveOnly = store.listRefs();
    expectListOk(liveOnly);
    expect(liveOnly.refs.map((ref) => ref.name)).toEqual(['main']);

    const withTombstones = store.listRefs({ includeTombstones: true });
    expectListOk(withTombstones);
    expect(withTombstones.refs.map((ref) => ref.name)).toEqual(['main', 'scenario/delete-me']);
    expect(withTombstones.refs.map((ref) => ref.state)).toEqual(['live', 'tombstone']);
  });
};
