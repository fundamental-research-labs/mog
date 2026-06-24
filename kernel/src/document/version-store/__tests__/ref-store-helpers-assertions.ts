import {
  RefStoreValidationError,
  createInMemoryRefStore,
  type CreateBranchResult,
  type DeleteRefResult,
  type GetRefResult,
  type ListRefsResult,
  type RefMutationResult,
} from '../refs/ref-store';
import type { InMemoryRefStoreSnapshot } from '../refs/ref-store-snapshot';

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
