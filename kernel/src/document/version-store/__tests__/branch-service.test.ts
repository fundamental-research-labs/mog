import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  createInMemoryBranchService,
  type BranchRefStore,
  type CreateBranchResult,
  type FastForwardBranchResult,
  type GetBranchHeadResult,
  type ListBranchesResult,
  type ReadBranchResult,
} from '../branch-service';
import { parseWorkbookCommitId, type WorkbookCommitId } from '../object-digest';
import { parseRefName, type RefName } from '../ref-name';
import {
  createInMemoryRefStore,
  type LiveRefRecord,
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

function createService() {
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

function expectCreateOk(
  result: CreateBranchResult,
): asserts result is Extract<CreateBranchResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected create ok: ${result.error.code}`);
}

function expectReadOk(
  result: ReadBranchResult,
): asserts result is Extract<ReadBranchResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected read ok: ${result.error.code}`);
}

function expectListOk(
  result: ListBranchesResult,
): asserts result is Extract<ListBranchesResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected list ok: ${result.error.code}`);
}

function expectFastForwardOk(
  result: FastForwardBranchResult,
): asserts result is Extract<FastForwardBranchResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected fast-forward ok: ${result.error.code}`);
}

function expectHeadOk(
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

describe('InMemoryBranchService branch lifecycle', () => {
  it('creates, reads, and lists visible refs/heads branches', () => {
    const { service } = createService();

    const created = service.createBranch({
      name: 'refs/heads/scenario%2Fbudget',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expectCreateOk(created);
    expect(created.branch).toMatchObject({
      name: 'scenario/budget',
      refName: 'refs/heads/scenario%2Fbudget',
    });
    expect(created.branch.ref).toMatchObject({
      state: 'live',
      targetCommitId: COMMIT_A,
      refVersion: refVersion('0'),
    });

    const byUserName = service.readBranch('scenario/budget');
    expectReadOk(byUserName);
    expect(byUserName.branch?.refName).toBe('refs/heads/scenario%2Fbudget');

    const byRefName = service.readBranch('refs/heads/scenario/budget');
    expectReadOk(byRefName);
    expect(byRefName.branch?.name).toBe('scenario/budget');

    const absent = service.readBranch('scenario/missing');
    expectReadOk(absent);
    expect(absent.branch).toBeNull();

    const list = service.listBranches();
    expectListOk(list);
    expect(list.branches.map((branch) => branch.refName)).toEqual([
      'refs/heads/main',
      'refs/heads/scenario%2Fbudget',
    ]);
  });

  it('returns duplicate branch conflicts from the ref store CAS record', () => {
    const { service } = createService();
    expectCreateOk(
      service.createBranch({
        name: 'scenario/duplicate',
        targetCommitId: COMMIT_A,
        expectedAbsent: true,
        createdBy: AUTHOR,
      }),
    );

    const duplicate = service.createBranch({
      name: 'scenario/duplicate',
      targetCommitId: COMMIT_B,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });

    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error('expected duplicate create to fail');
    expect(duplicate.error.code).toBe('refAlreadyExists');
    expect(duplicate.conflict).toMatchObject({
      code: 'refAlreadyExists',
      actualHead: COMMIT_A,
      actualRefVersion: refVersion('0'),
    });
  });

  it('fast-forwards with expected head and ref version and reports CAS conflicts', () => {
    const { service } = createService();
    const created = service.createBranch({
      name: 'scenario/advance',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expectCreateOk(created);

    const advanced = service.fastForwardBranch({
      name: 'scenario/advance',
      nextCommitId: COMMIT_B,
      expectedOldCommitId: COMMIT_A,
      expectedRefVersion: created.branch.ref.refVersion,
      updatedBy: AUTHOR,
    });
    expectFastForwardOk(advanced);
    expect(advanced.branch.ref).toMatchObject({
      targetCommitId: COMMIT_B,
      refVersion: refVersion('1'),
    });

    const staleHead = service.fastForwardBranch({
      name: 'scenario/advance',
      nextCommitId: COMMIT_C,
      expectedOldCommitId: COMMIT_A,
      expectedRefVersion: advanced.branch.ref.refVersion,
      updatedBy: AUTHOR,
    });
    expect(staleHead.ok).toBe(false);
    if (staleHead.ok) throw new Error('expected stale head update to fail');
    expect(staleHead.error.code).toBe('casConflict');
    expect(staleHead.diagnostics[0]).toMatchObject({
      code: 'casConflict',
      refName: 'scenario/advance',
      commitId: COMMIT_B,
      refVersion: refVersion('1'),
      details: { cause: 'expectedHeadMismatch' },
    });
    expect(staleHead.conflict).toMatchObject({
      code: 'expectedHeadMismatch',
      expectedHead: COMMIT_A,
      actualHead: COMMIT_B,
      actualRefVersion: refVersion('1'),
    });

    const staleRevision = service.fastForwardBranch({
      name: 'scenario/advance',
      nextCommitId: COMMIT_C,
      expectedOldCommitId: COMMIT_B,
      expectedRefVersion: created.branch.ref.refVersion,
      updatedBy: AUTHOR,
    });
    expect(staleRevision.ok).toBe(false);
    if (staleRevision.ok) throw new Error('expected stale refVersion update to fail');
    expect(staleRevision.error.code).toBe('casConflict');
    expect(staleRevision.conflict).toMatchObject({
      code: 'expectedRefVersionMismatch',
      expectedRefVersion: refVersion('0'),
      actualRefVersion: refVersion('1'),
      actualHead: COMMIT_B,
    });
  });

  it('requires the expected old head for fast-forward updates', () => {
    const { service } = createService();
    const created = service.createBranch({
      name: 'scenario/missing-head',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expectCreateOk(created);

    const missingHead = service.fastForwardBranch({
      name: 'scenario/missing-head',
      nextCommitId: COMMIT_B,
      expectedRefVersion: created.branch.ref.refVersion,
      updatedBy: AUTHOR,
    });

    expect(missingHead.ok).toBe(false);
    if (missingHead.ok) throw new Error('expected missing expected head to fail');
    expect(missingHead.error.code).toBe('missingExpectedHead');
    expect(missingHead.diagnostics).toEqual([
      expect.objectContaining({
        code: 'missingExpectedHead',
        refName: 'scenario/missing-head',
        details: { missingField: 'expectedOldCommitId' },
      }),
    ]);
  });

  it('rejects reserved namespaces and filters reserved rows from visible listings', () => {
    const { service } = createService();

    const reservedCreate = service.createBranch({
      name: 'refs/system/secret',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(reservedCreate.ok).toBe(false);
    if (reservedCreate.ok) throw new Error('expected reserved namespace create to fail');
    expect(reservedCreate.error.code).toBe('reservedNamespace');
    expect(reservedCreate.diagnostics).toEqual([
      expect.objectContaining({
        code: 'reservedNamespace',
        details: { namespace: 'refs/system' },
      }),
    ]);

    const fakeStore = fakeListOnlyStore([
      fakeLiveRef('scenario/visible'),
      fakeLiveRef('refs/system/hidden' as RefName),
      fakeLiveRef('refs/imports/hidden' as RefName),
    ]);
    const filteredService = createInMemoryBranchService({ refStore: fakeStore });
    const list = filteredService.listBranches();
    expectListOk(list);
    expect(list.branches.map((branch) => branch.name)).toEqual(['scenario/visible']);
    expect(list.diagnostics.map((item) => item.code)).toEqual([
      'reservedNamespace',
      'reservedNamespace',
    ]);
  });

  it('returns invalid ref diagnostics from ref-name validation', () => {
    const { service } = createService();

    const uppercase = service.createBranch({
      name: 'Scenario/Budget',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(uppercase.ok).toBe(false);
    if (uppercase.ok) throw new Error('expected uppercase ref to fail');
    expect(uppercase.error.code).toBe('invalidRefName');
    expect(uppercase.diagnostics.map((item) => item.code)).toContain('refName.containsUppercase');

    const badEncoding = service.createBranch({
      name: 'refs/heads/scenario%ZZ',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(badEncoding.ok).toBe(false);
    if (badEncoding.ok) throw new Error('expected bad encoded ref to fail');
    expect(badEncoding.error.code).toBe('invalidRefName');
    expect(badEncoding.diagnostics).toEqual([
      expect.objectContaining({
        code: 'invalidRefName',
        message: 'refs/heads/* branch ref contains invalid percent encoding.',
      }),
    ]);
  });

  it('reports symbolic HEAD state and rejects detached HEAD creation', () => {
    const { service } = createService();

    const head = service.getHead();
    expectHeadOk(head);
    expect(head.head).toEqual({
      mode: 'attached',
      refName: 'refs/heads/main',
      branchName: 'main',
      commitId: COMMIT_A,
      refVersion: refVersion('0'),
      refIncarnationId: expect.any(String),
    });

    const createHead = service.createBranch({
      name: 'HEAD',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(createHead.ok).toBe(false);
    if (createHead.ok) throw new Error('expected HEAD branch create to fail');
    expect(createHead.error.code).toBe('unsupportedDetachedHead');

    const detached = service.createDetachedHead({ commitId: COMMIT_A });
    expect(detached.ok).toBe(false);
    expect(detached.error.code).toBe('unsupportedDetachedHead');
    expect(detached.diagnostics[0]).toMatchObject({
      code: 'unsupportedDetachedHead',
      commitId: COMMIT_A,
    });
  });
});

function fakeListOnlyStore(refs: readonly LiveRefRecord[]): BranchRefStore {
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
  };
}

function fakeLiveRef(name: RefName | string): LiveRefRecord {
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
