import {
  AUTHOR,
  COMMIT_A,
  COMMIT_B,
  createStore,
  expectCreateOk,
  expectDeleteOk,
  expectListOk,
  expectMutationOk,
  refVersion,
} from './ref-store-test-helpers';

export const registerRefStoreTombstoneReuseScenarios = (): void => {
  it('requires explicit tombstone metadata before reusing a deleted name', () => {
    const store = createStore([
      '2026-06-20T00:00:00.000Z',
      '2026-06-20T00:00:01.000Z',
      '2026-06-20T00:00:02.000Z',
      '2026-06-20T00:00:03.000Z',
    ]);
    expectMutationOk(store.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR }));

    const created = store.createBranch({
      name: 'scenario/reuse-me',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expectCreateOk(created);

    const deleted = store.deleteRef({
      name: 'scenario/reuse-me',
      expectedHead: COMMIT_A,
      expectedRefVersion: created.ref.refVersion,
      deletedBy: AUTHOR,
    });
    expectDeleteOk(deleted);

    const staleVersion = store.createBranch({
      name: 'scenario/reuse-me',
      targetCommitId: COMMIT_B,
      expectedAbsent: true,
      createdBy: AUTHOR,
      reuseTombstone: {
        expectedTombstoneRefVersion: created.ref.refVersion,
        expectedPreviousRefIncarnationId: deleted.ref.previousRefIncarnationId,
      },
    });
    expect(staleVersion.ok).toBe(false);
    if (staleVersion.ok) throw new Error('expected stale tombstone version to fail');
    expect(staleVersion.error.code).toBe('expectedRefVersionMismatch');
    expect(staleVersion.conflict).toMatchObject({
      code: 'expectedRefVersionMismatch',
      expectedRefVersion: refVersion('0'),
      actualRefVersion: refVersion('1'),
      tombstoneRefVersion: refVersion('1'),
      previousRefIncarnationId: created.ref.refIncarnationId,
    });

    const staleIncarnation = store.createBranch({
      name: 'scenario/reuse-me',
      targetCommitId: COMMIT_B,
      expectedAbsent: true,
      createdBy: AUTHOR,
      reuseTombstone: {
        expectedTombstoneRefVersion: deleted.ref.refVersion,
        expectedPreviousRefIncarnationId: 'ref-incarnation:other',
      },
    });
    expect(staleIncarnation.ok).toBe(false);
    if (staleIncarnation.ok) throw new Error('expected stale tombstone incarnation to fail');
    expect(staleIncarnation.error.code).toBe('expectedPreviousRefIncarnationIdMismatch');
    expect(staleIncarnation.conflict).toMatchObject({
      code: 'expectedPreviousRefIncarnationIdMismatch',
      expectedPreviousRefIncarnationId: 'ref-incarnation:other',
      actualPreviousRefIncarnationId: created.ref.refIncarnationId,
      tombstoneRefVersion: refVersion('1'),
    });

    const recreated = store.createBranch({
      name: 'scenario/reuse-me',
      targetCommitId: COMMIT_B,
      expectedAbsent: true,
      createdBy: AUTHOR,
      reuseTombstone: {
        expectedTombstoneRefVersion: deleted.ref.refVersion,
        expectedPreviousRefIncarnationId: deleted.ref.previousRefIncarnationId,
      },
    });
    expectCreateOk(recreated);
    expect(recreated.ref).toMatchObject({
      state: 'live',
      name: 'scenario/reuse-me',
      targetCommitId: COMMIT_B,
      providerEpoch: { kind: 'counter', value: '1' },
      refVersion: refVersion('2'),
    });
    expect(recreated.ref.providerRefId).not.toBe(deleted.ref.previousProviderRefId);
    expect(recreated.ref.providerEpoch).not.toEqual(deleted.ref.previousProviderEpoch);
    expect(recreated.ref.refIncarnationId).not.toBe(deleted.ref.previousRefIncarnationId);

    const refs = store.listRefs({ includeTombstones: true });
    expectListOk(refs);
    expect(refs.refs.map((ref) => [ref.name, ref.state])).toEqual([
      ['main', 'live'],
      ['scenario/reuse-me', 'live'],
    ]);
  });
};
