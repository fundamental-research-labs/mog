import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { parseWorkbookCommitId, type WorkbookCommitId } from '../object-digest';
import { parseRefName } from '../ref-name';
import {
  RefStoreValidationError,
  createInMemoryRefStore,
  type CreateBranchResult,
  type DeleteRefResult,
  type GetRefResult,
  type ListRefsResult,
  type LiveRefRecord,
  type RefMutationResult,
  type RefVersion,
  type TombstoneRefRecord,
} from '../ref-store';
import type { InMemoryRefStoreSnapshot } from '../ref-store-snapshot';

export const COMMIT_A = commit('aa');
export const COMMIT_B = commit('bb');
export const COMMIT_C = commit('cc');

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

function commit(byte: string): WorkbookCommitId {
  return parseWorkbookCommitId(`commit:sha256:${byte.repeat(32)}`);
}

export function refVersion(value: string): RefVersion {
  return { kind: 'counter', value };
}

export function createStore(
  timestamps: readonly string[] = [],
): ReturnType<typeof createInMemoryRefStore> {
  const queue = [...timestamps];
  return createInMemoryRefStore({
    versionDocumentId: 'version-doc-1',
    now: () => queue.shift() ?? '2026-06-20T00:00:00.000Z',
  });
}

export function expectMutationOk(
  result: RefMutationResult,
): asserts result is Extract<RefMutationResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok result: ${result.error.code}`);
}

export function expectCreateOk(
  result: CreateBranchResult,
): asserts result is Extract<CreateBranchResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok result: ${result.error.code}`);
}

export function expectDeleteOk(
  result: DeleteRefResult,
): asserts result is Extract<DeleteRefResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok result: ${result.error.code}`);
}

export function expectGetFailed(
  result: GetRefResult,
): asserts result is Extract<GetRefResult, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected failed getRef result');
}

export function expectListOk(
  result: ListRefsResult,
): asserts result is Extract<ListRefsResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok result: ${result.error.code}`);
}

export function createBranch(
  store: ReturnType<typeof createInMemoryRefStore>,
  name: string,
): LiveRefRecord {
  const result = store.createBranch({
    name,
    targetCommitId: COMMIT_A,
    expectedAbsent: true,
    createdBy: AUTHOR,
  });
  expectCreateOk(result);
  return result.ref;
}

export function withMalformedRefName(
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

export function withMalformedRefVersion(
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

export function withMalformedTimestamp(
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

export function expectSnapshotRejectedWithRedactedName(
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

export function expectSnapshotRejectedWithRedactedRevision(
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

export function expectTimestampRejectedWithRedactedDiagnostics(
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

export function tombstoneFixture(name: string, deletedAt: string): TombstoneRefRecord {
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
