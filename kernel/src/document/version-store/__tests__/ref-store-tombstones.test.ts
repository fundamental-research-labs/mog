import { compareTombstoneRefs } from '../ref-store-ordering';
import {
  AUTHOR,
  COMMIT_A,
  COMMIT_B,
  createBranch,
  createStore,
  expectCreateOk,
  expectDeleteOk,
  expectGetFailed,
  expectListOk,
  expectMutationOk,
  refVersion,
  tombstoneFixture,
} from './ref-store-test-helpers';

describe('InMemoryRefStore tombstones', () => {
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
});

describe('InMemoryRefStore list filters and ordering', () => {
  it('uses namespace filters and orders live refs before tombstones', () => {
    const store = createStore([
      '2026-06-20T00:00:00.000Z',
      '2026-06-20T00:00:01.000Z',
      '2026-06-20T00:00:02.000Z',
      '2026-06-20T00:00:03.000Z',
      '2026-06-20T00:00:04.000Z',
      '2026-06-20T00:00:05.000Z',
      '2026-06-20T00:00:10.000Z',
      '2026-06-20T00:00:20.000Z',
      '2026-06-20T00:00:10.000Z',
    ]);

    expectMutationOk(store.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR }));

    const liveB = createBranch(store, 'scenario/live-b');
    const liveA = createBranch(store, 'scenario/live-a');
    const deletedAlpha = createBranch(store, 'scenario/deleted-alpha');
    const deletedLate = createBranch(store, 'scenario/deleted-late');
    const agentDeleted = createBranch(store, 'agent/deleted');

    expectDeleteOk(
      store.deleteRef({
        name: 'scenario/deleted-alpha',
        expectedHead: COMMIT_A,
        expectedRefVersion: deletedAlpha.refVersion,
        deletedBy: AUTHOR,
      }),
    );
    expectDeleteOk(
      store.deleteRef({
        name: 'scenario/deleted-late',
        expectedHead: COMMIT_A,
        expectedRefVersion: deletedLate.refVersion,
        deletedBy: AUTHOR,
      }),
    );
    expectDeleteOk(
      store.deleteRef({
        name: 'agent/deleted',
        expectedHead: COMMIT_A,
        expectedRefVersion: agentDeleted.refVersion,
        deletedBy: AUTHOR,
      }),
    );

    const scenarioRefs = store.listRefs({ prefix: 'scenario', includeTombstones: true });
    expectListOk(scenarioRefs);
    expect(scenarioRefs.refs.map((ref) => ref.name)).toEqual([
      liveA.name,
      liveB.name,
      'scenario/deleted-late',
      'scenario/deleted-alpha',
    ]);
    expect(scenarioRefs.refs.map((ref) => ref.state)).toEqual([
      'live',
      'live',
      'tombstone',
      'tombstone',
    ]);

    const allRefs = store.listRefs({ includeTombstones: true });
    expectListOk(allRefs);
    expect(allRefs.refs.map((ref) => ref.name)).toEqual([
      'main',
      'scenario/live-a',
      'scenario/live-b',
      'scenario/deleted-late',
      'agent/deleted',
      'scenario/deleted-alpha',
    ]);

    const arbitraryPrefix = store.listRefs({ prefix: 'scenario/live' as 'scenario' });
    expect(arbitraryPrefix.ok).toBe(false);
    if (arbitraryPrefix.ok) throw new Error('expected arbitrary prefix to fail');
    expect(arbitraryPrefix.error.code).toBe('invalidRefPrefix');
  });
});

describe('InMemoryRefStore tombstone ordering hardening', () => {
  it('keeps tombstone sorting deterministic when a persisted timestamp is malformed', () => {
    const valid = tombstoneFixture('scenario/valid', '2026-06-20T00:00:00.000Z');
    const invalidA = tombstoneFixture('scenario/a', 'invalid');
    const invalidB = tombstoneFixture('scenario/b', 'invalid');

    expect(compareTombstoneRefs(valid, invalidA)).toBeLessThan(0);
    expect(compareTombstoneRefs(invalidA, valid)).toBeGreaterThan(0);
    expect([invalidB, invalidA].sort(compareTombstoneRefs).map((record) => record.name)).toEqual([
      'scenario/a',
      'scenario/b',
    ]);
  });
});
