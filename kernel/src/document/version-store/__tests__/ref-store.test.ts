import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { parseWorkbookCommitId, type WorkbookCommitId } from '../object-digest';
import {
  RefStoreValidationError,
  createInMemoryRefStore,
  type CreateBranchResult,
  type DeleteRefResult,
  type GetRefResult,
  type ListRefsResult,
  type RefMutationResult,
  type RefVersion,
  type TombstoneRefRecord,
} from '../ref-store';
import { compareTombstoneRefs } from '../ref-store-ordering';
import type { InMemoryRefStoreSnapshot } from '../ref-store-snapshot';
import { parseRefName } from '../ref-name';

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

describe('InMemoryRefStore snapshot revision validation', () => {
  it('rejects malformed live ref revision counters with redacted diagnostics', () => {
    const store = createStore();
    expectMutationOk(store.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR }));

    const snapshot = store.exportSnapshot();
    const malformedSnapshot = withMalformedRefVersion(snapshot, 'main', refVersion('01'));

    expectSnapshotRejectedWithRedactedRevision(malformedSnapshot, 'counterFormat');
  });

  it('rejects malformed tombstone ref revision counters with redacted diagnostics', () => {
    const store = createStore([
      '2026-06-20T00:00:00.000Z',
      '2026-06-20T00:00:01.000Z',
      '2026-06-20T00:00:02.000Z',
    ]);
    expectMutationOk(store.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR }));
    const created = store.createBranch({
      name: 'scenario/malformed-tombstone',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expectCreateOk(created);
    expectDeleteOk(
      store.deleteRef({
        name: 'scenario/malformed-tombstone',
        expectedHead: COMMIT_A,
        expectedRefVersion: created.ref.refVersion,
        deletedBy: AUTHOR,
      }),
    );

    const snapshot = store.exportSnapshot();
    const malformedSnapshot = withMalformedRefVersion(
      snapshot,
      'scenario/malformed-tombstone',
      refVersion('01'),
    );

    expectSnapshotRejectedWithRedactedRevision(malformedSnapshot, 'counterFormat');
  });
});

describe('InMemoryRefStore W17 lifecycle hardening', () => {
  it('redacts invalid ref names from mutation diagnostics', () => {
    const store = createStore();
    expectMutationOk(store.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR }));

    const rawRefName = 'scenario/Secret Branch';
    const result = store.createBranch({
      name: rawRefName,
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected invalid ref name to fail');
    expect(result.error.code).toBe('invalidRefName');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every((item) => item.details?.redacted === true)).toBe(true);
    expect(result.diagnostics.map((item) => item.code)).toContain('refName.containsWhitespace');
    expect(JSON.stringify(result)).not.toContain(rawRefName);
  });

  it('rejects malformed snapshot ref names with redacted diagnostics', () => {
    const store = createStore();
    expectMutationOk(store.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR }));

    const rawRefName = 'scenario/Secret Snapshot';
    const malformedSnapshot = withMalformedRefName(store.exportSnapshot(), 'main', rawRefName);

    expectSnapshotRejectedWithRedactedName(malformedSnapshot, rawRefName);
  });

  it('normalizes Date clocks and rejects malformed timestamps with redacted diagnostics', () => {
    const dateStore = createInMemoryRefStore({
      versionDocumentId: 'version-doc-1',
      now: () => new Date('2026-06-20T00:00:00.123Z'),
    });
    const initialized = dateStore.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR });
    expectMutationOk(initialized);
    expect(initialized.ref.createdAt).toBe('2026-06-20T00:00:00.123Z');
    expect(initialized.ref.updatedAt).toBe('2026-06-20T00:00:00.123Z');

    const rawTimestamp = '2026-02-31T00:00:00.000Z';
    const invalidClockStore = createInMemoryRefStore({
      versionDocumentId: 'version-doc-1',
      now: () => rawTimestamp,
    });

    expectTimestampRejectedWithRedactedDiagnostics(
      () => invalidClockStore.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR }),
      'now',
      rawTimestamp,
    );
  });

  it('rejects malformed snapshot timestamps with redacted diagnostics', () => {
    const store = createStore();
    expectMutationOk(store.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR }));

    const rawTimestamp = '2026-13-20T00:00:00.000Z';
    const malformedSnapshot = withMalformedTimestamp(
      store.exportSnapshot(),
      'main',
      'createdAt',
      rawTimestamp,
    );

    expectTimestampRejectedWithRedactedDiagnostics(
      () =>
        createInMemoryRefStore({
          versionDocumentId: 'version-doc-1',
          snapshot: malformedSnapshot,
        }),
      'record.createdAt',
      rawTimestamp,
    );
  });

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

function withMalformedRefName(
  snapshot: InMemoryRefStoreSnapshot,
  existingName: string,
  nextName: string,
): InMemoryRefStoreSnapshot {
  return Object.freeze({
    ...snapshot,
    records: Object.freeze(
      snapshot.records.map((record) =>
        record.name === existingName ? Object.freeze({ ...record, name: nextName }) : record,
      ),
    ),
  }) as InMemoryRefStoreSnapshot;
}

function withMalformedRefVersion(
  snapshot: InMemoryRefStoreSnapshot,
  name: string,
  refVersion: RefVersion,
): InMemoryRefStoreSnapshot {
  return Object.freeze({
    ...snapshot,
    records: Object.freeze(
      snapshot.records.map((record) =>
        record.name === name ? Object.freeze({ ...record, refVersion }) : record,
      ),
    ),
  });
}

function withMalformedTimestamp(
  snapshot: InMemoryRefStoreSnapshot,
  name: string,
  field: 'createdAt' | 'updatedAt' | 'deletedAt',
  value: string,
): InMemoryRefStoreSnapshot {
  return Object.freeze({
    ...snapshot,
    records: Object.freeze(
      snapshot.records.map((record) =>
        record.name === name ? Object.freeze({ ...record, [field]: value }) : record,
      ),
    ),
  }) as InMemoryRefStoreSnapshot;
}

function expectSnapshotRejectedWithRedactedName(
  snapshot: InMemoryRefStoreSnapshot,
  rawRefName: string,
): void {
  let caught: unknown;
  try {
    createInMemoryRefStore({
      versionDocumentId: 'version-doc-1',
      snapshot,
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(RefStoreValidationError);
  if (!(caught instanceof RefStoreValidationError)) {
    throw new Error('expected RefStoreValidationError');
  }
  expect(caught.code).toBe('invalidRefName');
  expect(caught.diagnostics.length).toBeGreaterThan(0);
  expect(caught.diagnostics.every((item) => item.details?.redacted === true)).toBe(true);
  expect(JSON.stringify(caught.diagnostics)).not.toContain(rawRefName);
}

function expectSnapshotRejectedWithRedactedRevision(
  snapshot: InMemoryRefStoreSnapshot,
  expectedIssue: string,
): void {
  let caught: unknown;
  try {
    createInMemoryRefStore({
      versionDocumentId: 'version-doc-1',
      snapshot,
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(RefStoreValidationError);
  if (!(caught instanceof RefStoreValidationError)) {
    throw new Error('expected RefStoreValidationError');
  }
  expect(caught.code).toBe('invalidRefVersion');
  expect(caught.diagnostics).toHaveLength(1);
  expect(caught.diagnostics[0]).toMatchObject({
    code: 'invalidRefVersion',
    severity: 'error',
    details: {
      issue: expectedIssue,
      redacted: true,
    },
  });
  expect(JSON.stringify(caught.diagnostics)).not.toContain('01');
}

function expectTimestampRejectedWithRedactedDiagnostics(
  run: () => unknown,
  expectedPath: string,
  rawTimestamp: string,
): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(RefStoreValidationError);
  if (!(caught instanceof RefStoreValidationError)) {
    throw new Error('expected RefStoreValidationError');
  }
  expect(caught.code).toBe('versionCapabilityDisabled');
  expect(caught.diagnostics).toEqual([
    expect.objectContaining({
      code: 'invalidTimestamp',
      severity: 'error',
      details: expect.objectContaining({
        path: expectedPath,
        redacted: true,
      }),
    }),
  ]);
  expect(JSON.stringify(caught.diagnostics)).not.toContain(rawTimestamp);
}

function tombstoneFixture(name: string, deletedAt: string): TombstoneRefRecord {
  return Object.freeze({
    state: 'tombstone',
    schemaVersion: 1,
    versionDocumentId: 'version-doc-1',
    name: parseRefName(name),
    previousTargetCommitId: COMMIT_A,
    previousProviderRefId: 'provider-ref:version-doc-1:1',
    previousProviderEpoch: Object.freeze({ kind: 'counter', value: '0' }),
    previousRefIncarnationId: 'ref-incarnation:version-doc-1:2',
    deletedAt,
    deletedBy: AUTHOR,
    refVersion: refVersion('1'),
  });
}
