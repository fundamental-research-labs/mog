import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  createInMemoryBranchService,
  type BranchRefStore,
  type CreateBranchResult,
  type DeleteBranchResult,
  type FastForwardBranchResult,
  type GetBranchHeadResult,
  type ListBranchesResult,
  type ReadBranchResult,
} from '../branch-service';
import { parseWorkbookCommitId, type WorkbookCommitId } from '../object-digest';
import { parseRefName, type RefName } from '../refs/ref-name';
import {
  createInMemoryRefStore,
  type LiveRefRecord,
  type RefMutationResult,
  type RefVersion,
} from '../refs/ref-store';

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

export function createService() {
  const refStore = createInMemoryRefStore({
    versionDocumentId: 'version-doc-1',
    now: () => '2026-06-20T00:00:00.000Z',
  });
  const main = refStore.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR });
  expectMutationOk(main);

  return {
    refStore,
    service: createInMemoryBranchService({ refStore }),
    main: main.ref,
  };
}

export function expectCreateOk(
  result: CreateBranchResult,
): asserts result is Extract<CreateBranchResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected create ok: ${result.error.code}`);
}

export function expectReadOk(
  result: ReadBranchResult,
): asserts result is Extract<ReadBranchResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected read ok: ${result.error.code}`);
}

export function expectListOk(
  result: ListBranchesResult,
): asserts result is Extract<ListBranchesResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected list ok: ${result.error.code}`);
}

export function expectFastForwardOk(
  result: FastForwardBranchResult,
): asserts result is Extract<FastForwardBranchResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected fast-forward ok: ${result.error.code}`);
}

export function expectDeleteOk(
  result: DeleteBranchResult,
): asserts result is Extract<DeleteBranchResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected delete ok: ${result.error.code}`);
}

export function expectHeadOk(
  result: GetBranchHeadResult,
): asserts result is Extract<GetBranchHeadResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected head ok: ${result.error.code}`);
}

function expectMutationOk(
  result: RefMutationResult,
): asserts result is Extract<RefMutationResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected mutation ok: ${result.error.code}`);
}

export function fakeListOnlyStore(refs: readonly LiveRefRecord[]): BranchRefStore {
  return {
    createBranch() {
      throw new Error('not used by this test');
    },
    getRef() {
      throw new Error('not used by this test');
    },
    listRefs() {
      return {
        ok: true,
        includeTombstones: false,
        refs,
        diagnostics: [],
      };
    },
    updateRef() {
      throw new Error('not used by this test');
    },
    deleteRef() {
      throw new Error('not used by this test');
    },
  };
}

export function fakeLiveRef(name: RefName | string): LiveRefRecord {
  return {
    state: 'live',
    schemaVersion: 1,
    versionDocumentId: 'version-doc-1',
    name:
      typeof name === 'string' && !name.startsWith('refs/')
        ? parseRefName(name)
        : (name as RefName),
    kind: 'branch',
    targetCommitId: COMMIT_A,
    providerRefId: `provider-ref:${name}`,
    providerEpoch: { kind: 'counter', value: '0' },
    refIncarnationId: `ref-incarnation:${name}`,
    protected: false,
    createdAt: '2026-06-20T00:00:00.000Z',
    createdBy: AUTHOR,
    updatedAt: '2026-06-20T00:00:00.000Z',
    updatedBy: AUTHOR,
    refVersion: refVersion('0'),
  };
}
