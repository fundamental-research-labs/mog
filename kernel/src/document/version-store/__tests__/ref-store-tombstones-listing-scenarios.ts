import {
  AUTHOR,
  COMMIT_A,
  createBranch,
  createStore,
  expectDeleteOk,
  expectListOk,
  expectMutationOk,
} from './ref-store-test-helpers';

export const registerRefStoreTombstoneListingScenarios = (): void => {
  it('uses branch-prefix filters and orders live refs before tombstones', () => {
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

    const liveB = createBranch(store, 'scenario/live/b');
    const liveA = createBranch(store, 'scenario/live/a');
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
      'scenario/live/a',
      'scenario/live/b',
      'scenario/deleted-late',
      'agent/deleted',
      'scenario/deleted-alpha',
    ]);

    const arbitraryPrefix = store.listRefs({
      prefix: 'scenario/live',
      includeTombstones: true,
    });
    expectListOk(arbitraryPrefix);
    expect(arbitraryPrefix.refs.map((ref) => ref.name)).toEqual([liveA.name, liveB.name]);
  });
};
