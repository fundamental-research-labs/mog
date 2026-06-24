import {
  AUTHOR,
  COMMIT_A,
  COMMIT_B,
  COMMIT_C,
  createStore,
  expectCreateOk,
  expectDeleteOk,
  expectMutationOk,
  refVersion,
} from './ref-store-test-helpers';

describe('InMemoryRefStore main initialization', () => {
  it('creates protected initial main only through the root initialization path', () => {
    const store = createStore();

    const main = store.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR });
    expectMutationOk(main);
    expect(main.ref).toMatchObject({
      state: 'live',
      name: 'main',
      targetCommitId: COMMIT_A,
      protected: true,
      refVersion: refVersion('0'),
    });

    const duplicateMain = store.createBranch({
      name: 'main',
      targetCommitId: COMMIT_B,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(duplicateMain.ok).toBe(false);
    if (duplicateMain.ok) throw new Error('expected protected main create to fail');
    expect(duplicateMain.error.code).toBe('protectedRef');
    expect(duplicateMain.conflict).toBeUndefined();

    const updateMain = store.updateRef({
      name: 'main',
      nextCommitId: COMMIT_B,
      expectedHead: COMMIT_A,
      expectedRefVersion: main.ref.refVersion,
      updatedBy: AUTHOR,
    });
    expect(updateMain.ok).toBe(false);
    if (updateMain.ok) throw new Error('expected protected main update to fail');
    expect(updateMain.error.code).toBe('protectedRef');

    const deleteMain = store.deleteRef({
      name: 'main',
      expectedHead: COMMIT_A,
      expectedRefVersion: main.ref.refVersion,
      deletedBy: AUTHOR,
    });
    expect(deleteMain.ok).toBe(false);
    if (deleteMain.ok) throw new Error('expected protected main delete to fail');
    expect(deleteMain.error.code).toBe('protectedRef');
  });
});

describe('InMemoryRefStore branch CAS', () => {
  it('creates branches and updates by expected RefVersion', () => {
    const store = createStore();
    expectMutationOk(store.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR }));

    const created = store.createBranch({
      name: 'scenario/budget',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expectCreateOk(created);
    expect(created.ref.refVersion).toEqual(refVersion('0'));

    const updated = store.updateRef({
      name: 'scenario/budget',
      nextCommitId: COMMIT_B,
      expectedHead: COMMIT_A,
      expectedRefVersion: created.ref.refVersion,
      updatedBy: AUTHOR,
    });
    expectMutationOk(updated);
    expect(updated.ref).toMatchObject({
      targetCommitId: COMMIT_B,
      refVersion: refVersion('1'),
    });

    const stale = store.updateRef({
      name: 'scenario/budget',
      nextCommitId: COMMIT_C,
      expectedHead: COMMIT_B,
      expectedRefVersion: created.ref.refVersion,
      updatedBy: AUTHOR,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error('expected stale update to fail');
    expect(stale.error.code).toBe('expectedRefVersionMismatch');
    expect(stale.conflict).toMatchObject({
      code: 'expectedRefVersionMismatch',
      expectedRefVersion: refVersion('0'),
      actualRefVersion: refVersion('1'),
      actualHead: COMMIT_B,
    });
  });
});

describe('InMemoryRefStore delete invariants', () => {
  it('rejects stale delete ref versions without tombstoning the live ref', () => {
    const store = createStore();
    expectMutationOk(store.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR }));

    const created = store.createBranch({
      name: 'scenario/delete-cas',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expectCreateOk(created);

    const updated = store.updateRef({
      name: 'scenario/delete-cas',
      nextCommitId: COMMIT_B,
      expectedHead: COMMIT_A,
      expectedRefVersion: created.ref.refVersion,
      updatedBy: AUTHOR,
    });
    expectMutationOk(updated);

    const staleDelete = store.deleteRef({
      name: 'scenario/delete-cas',
      expectedHead: COMMIT_B,
      expectedRefVersion: created.ref.refVersion,
      deletedBy: AUTHOR,
    });
    expect(staleDelete.ok).toBe(false);
    if (staleDelete.ok) throw new Error('expected stale delete ref version to fail');
    expect(staleDelete.error.code).toBe('expectedRefVersionMismatch');
    expect(staleDelete.conflict).toMatchObject({
      code: 'expectedRefVersionMismatch',
      expectedRefVersion: refVersion('0'),
      actualRefVersion: refVersion('1'),
      actualHead: COMMIT_B,
    });

    const stillLive = store.getRef('scenario/delete-cas');
    expect(stillLive.ok).toBe(true);
    if (!stillLive.ok) throw new Error('expected ref read to succeed');
    expect(stillLive.ref).toMatchObject({
      state: 'live',
      name: 'scenario/delete-cas',
      targetCommitId: COMMIT_B,
      refVersion: refVersion('1'),
    });
  });

  it('rejects deleting the last live ref from the current store state', () => {
    const store = createStore();
    const main = store.initializeMain({
      targetCommitId: COMMIT_A,
      createdBy: AUTHOR,
      protected: false,
    });
    expectMutationOk(main);
    expect(store.exportSnapshot().liveRefCount).toBe(1);

    const deleteMain = store.deleteRef({
      name: 'main',
      expectedHead: COMMIT_A,
      expectedRefVersion: main.ref.refVersion,
      deletedBy: AUTHOR,
    });
    expect(deleteMain.ok).toBe(false);
    if (deleteMain.ok) throw new Error('expected last live ref delete to fail');
    expect(deleteMain.error.code).toBe('lastLiveRef');
    expect(store.exportSnapshot().liveRefCount).toBe(1);

    const branch = store.createBranch({
      name: 'scenario/last-delete',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expectCreateOk(branch);
    expect(store.exportSnapshot().liveRefCount).toBe(2);

    expectDeleteOk(
      store.deleteRef({
        name: 'main',
        expectedHead: COMMIT_A,
        expectedRefVersion: main.ref.refVersion,
        deletedBy: AUTHOR,
      }),
    );
    expect(store.exportSnapshot().liveRefCount).toBe(1);

    const deleteBranch = store.deleteRef({
      name: 'scenario/last-delete',
      expectedHead: COMMIT_A,
      expectedRefVersion: branch.ref.refVersion,
      deletedBy: AUTHOR,
    });
    expect(deleteBranch.ok).toBe(false);
    if (deleteBranch.ok) throw new Error('expected last remaining branch delete to fail');
    expect(deleteBranch.error.code).toBe('lastLiveRef');
    expect(store.exportSnapshot().liveRefCount).toBe(1);
  });
});
