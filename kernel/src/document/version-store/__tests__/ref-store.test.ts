import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { parseWorkbookCommitId, type WorkbookCommitId } from '../object-digest';
import {
  createInMemoryRefStore,
  type CreateBranchResult,
  type DeleteRefResult,
  type GetRefResult,
  type ListRefsResult,
  type RefMutationResult,
  type RefVersion,
} from '../ref-store';

const COMMIT_A = commit('aa');
const COMMIT_B = commit('bb');
const COMMIT_C = commit('cc');

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

function commit(byte: string): WorkbookCommitId {
  return parseWorkbookCommitId(`commit:sha256:${byte.repeat(32)}`);
}

function refVersion(value: string): RefVersion {
  return { kind: 'counter', value };
}

function createStore(timestamps: readonly string[] = []) {
  const queue = [...timestamps];
  return createInMemoryRefStore({
    versionDocumentId: 'version-doc-1',
    now: () => queue.shift() ?? '2026-06-20T00:00:00.000Z',
  });
}

function expectMutationOk(
  result: RefMutationResult,
): asserts result is Extract<RefMutationResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok result: ${result.error.code}`);
}

function expectCreateOk(
  result: CreateBranchResult,
): asserts result is Extract<CreateBranchResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok result: ${result.error.code}`);
}

function expectDeleteOk(
  result: DeleteRefResult,
): asserts result is Extract<DeleteRefResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok result: ${result.error.code}`);
}

function expectGetFailed(
  result: GetRefResult,
): asserts result is Extract<GetRefResult, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected failed getRef result');
}

function expectListOk(
  result: ListRefsResult,
): asserts result is Extract<ListRefsResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok result: ${result.error.code}`);
}

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

function createBranch(store: ReturnType<typeof createInMemoryRefStore>, name: string) {
  const result = store.createBranch({
    name,
    targetCommitId: COMMIT_A,
    expectedAbsent: true,
    createdBy: AUTHOR,
  });
  expectCreateOk(result);
  return result.ref;
}
