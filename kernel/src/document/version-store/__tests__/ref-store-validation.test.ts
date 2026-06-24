import { createInMemoryRefStore } from '../refs/ref-store';
import {
  AUTHOR,
  COMMIT_A,
  createStore,
  expectCreateOk,
  expectDeleteOk,
  expectMutationOk,
  expectSnapshotRejectedWithRedactedName,
  expectSnapshotRejectedWithRedactedRevision,
  expectTimestampRejectedWithRedactedDiagnostics,
  refVersion,
  withMalformedRefName,
  withMalformedRefVersion,
  withMalformedTimestamp,
} from './ref-store-test-helpers';

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
});
