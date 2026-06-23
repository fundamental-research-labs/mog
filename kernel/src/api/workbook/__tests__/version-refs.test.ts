import { jest } from '@jest/globals';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createInMemoryBranchService } from '../../../document/version-store/branch-service';
import {
  parseWorkbookCommitId,
  type WorkbookCommitId,
} from '../../../document/version-store/object-digest';
import { createInMemoryRefStore, type RefVersion } from '../../../document/version-store/ref-store';
import { WorkbookVersionImpl } from '../version';

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

function createWorkbookVersionWithBranchService(headRefName?: string | null) {
  const refStore = createInMemoryRefStore({
    versionDocumentId: 'version-doc-1',
    now: () => '2026-06-20T00:00:00.000Z',
  });
  const main = refStore.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR });
  expect(main.ok).toBe(true);
  if (!main.ok) throw new Error(`expected main initialization: ${main.error.code}`);

  const branchService = createInMemoryBranchService({
    refStore,
    ...(headRefName !== undefined ? { headRefName } : {}),
  });
  const version = new WorkbookVersionImpl({
    versioning: { branchService },
  } as any);

  return { branchService, refStore, version };
}

describe('WorkbookVersion public ref lifecycle facade', () => {
  it('fails closed when no branch service is attached', async () => {
    const version = new WorkbookVersionImpl({ versioning: {} } as any);

    await expect(version.listRefs()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_GRAPH_UNINITIALIZED' })],
      },
    });

    await expect(
      version.createBranch({ name: 'scenario/missing' as any, targetCommitId: COMMIT_A }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REF_WRITE_UNAVAILABLE',
            data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
          }),
        ],
      },
    });

    await expect(
      version.deleteRef({
        name: 'scenario/missing' as any,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REF_WRITE_UNAVAILABLE',
            data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
          }),
        ],
      },
    });
  });

  it('creates, reads, gets, and lists public branch refs through the attached service', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();

    await expect(
      version.createBranch({
        name: 'scenario/budget' as any,
        targetCommitId: COMMIT_A,
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        name: 'refs/heads/scenario/budget',
        commitId: COMMIT_A,
        revision: refVersion('0'),
        updatedAt: '2026-06-20T00:00:00.000Z',
      },
    });

    await expect(version.readRef('refs/heads/scenario/budget' as any)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'refs/heads/scenario/budget',
          commitId: COMMIT_A,
          revision: refVersion('0'),
        },
      },
    });

    await expect(version.getRef('scenario/budget' as any)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'refs/heads/scenario/budget',
          commitId: COMMIT_A,
        },
      },
    });

    await expect(version.getRef('HEAD')).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'HEAD',
          target: 'refs/heads/main',
          revision: refVersion('0'),
        },
        diagnostics: [],
      },
    });

    await expect(version.listRefs()).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({ name: 'refs/heads/main', commitId: COMMIT_A }),
          expect.objectContaining({ name: 'refs/heads/scenario/budget', commitId: COMMIT_A }),
        ],
        limit: 50,
      },
    });

    expect(branchService.readBranch('scenario/budget')).toMatchObject({
      ok: true,
      branch: {
        name: 'scenario/budget',
      },
    });
  });

  it('reports symbolic HEAD from the attached branch service target', async () => {
    const { version } = createWorkbookVersionWithBranchService('scenario/attached');
    await version.createBranch({ name: 'scenario/attached' as any, targetCommitId: COMMIT_A });

    await expect(version.getRef('HEAD')).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'HEAD',
          target: 'refs/heads/scenario/attached',
          revision: refVersion('0'),
        },
        diagnostics: [],
      },
    });
  });

  it('filters listRefs by namespace only without mutating state', async () => {
    const { version } = createWorkbookVersionWithBranchService();

    await version.createBranch({ name: 'scenario/budget' as any, targetCommitId: COMMIT_A });
    await version.createBranch({ name: 'scenario/forecast/q1' as any, targetCommitId: COMMIT_A });
    await version.createBranch({ name: 'agent/run-1' as any, targetCommitId: COMMIT_A });

    const scenarioRefs = await version.listRefs({ prefix: 'scenario' as any });
    expect(scenarioRefs.ok).toBe(true);
    if (!scenarioRefs.ok) throw new Error(`expected listRefs success: ${scenarioRefs.error.code}`);
    expect(scenarioRefs.value.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'refs/heads/scenario/budget' }),
        expect.objectContaining({ name: 'refs/heads/scenario/forecast/q1' }),
      ]),
    );
    expect(scenarioRefs.value.items).toHaveLength(2);

    const fullNamespaceRefs = await version.listRefs({ prefix: 'refs/heads/scenario' as any });
    expect(fullNamespaceRefs).toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({ name: 'refs/heads/scenario/budget' }),
          expect.objectContaining({ name: 'refs/heads/scenario/forecast/q1' }),
        ],
        limit: 50,
      },
    });
    expect(fullNamespaceRefs.ok && fullNamespaceRefs.value.items).toHaveLength(2);

    await expect(
      version.listRefs({ prefix: 'refs/heads/scenario/forecast' as any }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              payload: expect.objectContaining({ option: 'prefix' }),
            }),
          }),
        ],
      },
    });

    const allRefs = await version.listRefs();
    expect(allRefs.ok).toBe(true);
    if (!allRefs.ok) throw new Error(`expected listRefs success: ${allRefs.error.code}`);
    expect(allRefs.value.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'refs/heads/main' }),
        expect.objectContaining({ name: 'refs/heads/agent/run-1' }),
        expect.objectContaining({ name: 'refs/heads/scenario/budget' }),
        expect.objectContaining({ name: 'refs/heads/scenario/forecast/q1' }),
      ]),
    );
    expect(allRefs.value.items).toHaveLength(4);
    expect(allRefs.value.limit).toBe(50);
  });

  it('rejects invalid names and protected main mutations before service calls', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();
    const createBranch = jest.spyOn(branchService, 'createBranch');
    const fastForwardBranch = jest.spyOn(branchService, 'fastForwardBranch');
    const deleteBranch = jest.spyOn(branchService, 'deleteBranch');

    const invalidName = await version.createBranch({
      name: 'Scenario/Budget' as any,
      targetCommitId: COMMIT_A,
    });
    expect(invalidName).toMatchObject({
      ok: false,
      error: { code: 'target_unavailable' },
    });
    expect(invalidName.ok).toBe(false);
    if (invalidName.ok) throw new Error('expected invalid createBranch to fail');
    expect(invalidName.error.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'VERSION_INVALID_OPTIONS',
          data: expect.objectContaining({
            payload: expect.objectContaining({ refName: 'redacted', issue: 'containsUppercase' }),
          }),
        }),
      ]),
    );
    expect(createBranch).not.toHaveBeenCalled();

    await expect(
      version.createBranch({ name: 'main' as any, targetCommitId: COMMIT_A }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PERMISSION_DENIED',
            data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
          }),
        ],
      },
    });
    expect(createBranch).not.toHaveBeenCalled();

    await expect(
      version.fastForwardBranch({
        name: 'refs/heads/main' as any,
        nextCommitId: COMMIT_B,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_PERMISSION_DENIED' })],
      },
    });
    expect(fastForwardBranch).not.toHaveBeenCalled();

    await expect(
      version.deleteRef({
        name: 'refs/heads/main' as any,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_PERMISSION_DENIED' })],
      },
    });
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it('fast-forwards and updateBranch aliases fast-forward with stale guards', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();
    await version.createBranch({ name: 'scenario/advance' as any, targetCommitId: COMMIT_A });

    await expect(
      version.fastForwardBranch({
        name: 'scenario/advance' as any,
        nextCommitId: COMMIT_B,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/advance',
        commitId: COMMIT_B,
        revision: refVersion('1'),
      },
    });

    await expect(
      version.updateBranch({
        name: 'scenario/advance' as any,
        nextCommitId: COMMIT_C,
        expectedHead: COMMIT_B,
        expectedRefRevision: refVersion('1'),
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/advance',
        commitId: COMMIT_C,
        revision: refVersion('2'),
      },
    });

    const stale = await version.fastForwardBranch({
      name: 'scenario/advance' as any,
      nextCommitId: COMMIT_A,
      expectedHead: COMMIT_B,
      expectedRefRevision: refVersion('1'),
    });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: 'target_unavailable' },
    });
    if (stale.ok) throw new Error('expected stale fastForwardBranch to fail');
    expect(stale.error.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'VERSION_REF_CONFLICT',
          data: expect.objectContaining({
            mutationGuarantee: 'no-write-attempted',
            payload: expect.objectContaining({
              actualHead: COMMIT_C,
              actualRefRevision: 'rv:n:2',
              conflict: 'expectedHeadMismatch',
            }),
            recoverability: 'retry',
          }),
        }),
      ]),
    );

    expect(branchService.readBranch('scenario/advance')).toMatchObject({
      ok: true,
      branch: {
        ref: {
          targetCommitId: COMMIT_C,
          refVersion: refVersion('2'),
        },
      },
    });
  });

  it('deletes public branch refs through the attached service', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();
    await version.createBranch({ name: 'scenario/delete-me' as any, targetCommitId: COMMIT_A });

    const staleDelete = await version.deleteRef({
      name: 'scenario/delete-me' as any,
      expectedHead: COMMIT_B,
      expectedRefRevision: refVersion('0'),
    });
    expect(staleDelete.ok).toBe(false);
    if (staleDelete.ok) throw new Error('expected stale deleteRef to fail');
    expect(staleDelete.error.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'VERSION_REF_CONFLICT',
          data: expect.objectContaining({
            mutationGuarantee: 'no-write-attempted',
            payload: expect.objectContaining({
              actualHead: COMMIT_A,
              actualRefRevision: 'rv:n:0',
              conflict: 'expectedHeadMismatch',
            }),
          }),
        }),
      ]),
    );

    await expect(
      version.deleteBranch({
        name: 'scenario/delete-me' as any,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/delete-me',
        commitId: COMMIT_A,
        revision: refVersion('1'),
        updatedAt: '2026-06-20T00:00:00.000Z',
      },
    });

    expect(branchService.readBranch('scenario/delete-me')).toMatchObject({
      ok: false,
      error: {
        code: 'refTombstoned',
      },
    });

    await version.createBranch({ name: 'scenario/delete-ref' as any, targetCommitId: COMMIT_A });

    await expect(
      version.deleteRef({
        name: 'refs/heads/scenario/delete-ref' as any,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/delete-ref',
        commitId: COMMIT_A,
        revision: refVersion('1'),
      },
    });
  });

  it('blocks deleting the active branch before tombstoning the current head', async () => {
    const { branchService, version } =
      createWorkbookVersionWithBranchService('scenario/active-delete');
    await version.createBranch({
      name: 'scenario/active-delete' as any,
      targetCommitId: COMMIT_A,
    });

    const deleted = await version.deleteBranch({
      name: 'scenario/active-delete' as any,
      expectedHead: COMMIT_A,
      expectedRefRevision: refVersion('0'),
    });

    expect(deleted).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REF_WRITE_UNAVAILABLE',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                issue: 'activeBranchDelete',
                operation: 'deleteBranch',
              }),
            }),
          }),
        ],
      },
    });
    expect(branchService.readBranch('scenario/active-delete')).toMatchObject({
      ok: true,
      branch: {
        ref: {
          state: 'live',
          targetCommitId: COMMIT_A,
          refVersion: refVersion('0'),
        },
      },
    });
  });

  it('rejects public rename shapes and name-only metadata mutations without moving refs', async () => {
    const { branchService, version } =
      createWorkbookVersionWithBranchService('scenario/rename-source');
    await version.createBranch({
      name: 'scenario/rename-source' as any,
      targetCommitId: COMMIT_A,
    });
    const fastForwardBranch = jest.spyOn(branchService, 'fastForwardBranch');

    const renameShape = await version.updateBranch({
      name: 'scenario/rename-source' as any,
      nextCommitId: COMMIT_A,
      expectedHead: COMMIT_A,
      expectedRefRevision: refVersion('0'),
      newName: 'scenario/rename-target',
    } as any);
    expect(renameShape).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({ option: 'newName' }),
            }),
          }),
        ],
      },
    });
    expect(fastForwardBranch).not.toHaveBeenCalled();

    const metadataOnly = await version.updateBranch({
      name: 'scenario/rename-source' as any,
      nextCommitId: COMMIT_A,
      expectedHead: COMMIT_A,
      expectedRefRevision: refVersion('0'),
    });
    expect(metadataOnly).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REF_WRITE_UNAVAILABLE',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ],
      },
    });
    expect(branchService.readBranch('scenario/rename-source')).toMatchObject({
      ok: true,
      branch: {
        ref: {
          targetCommitId: COMMIT_A,
          refVersion: refVersion('0'),
        },
      },
    });
    expect(branchService.readBranch('scenario/rename-target')).toEqual({
      ok: true,
      branch: null,
      diagnostics: [],
    });
  });

  it('enforces default and protected branch policy for public lifecycle writes', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();
    const protectedBranch = branchService.createBranch({
      name: 'scenario/protected',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
      protected: true,
    });
    expect(protectedBranch.ok).toBe(true);
    if (!protectedBranch.ok)
      throw new Error(`expected protected branch: ${protectedBranch.error.code}`);

    await expect(
      version.fastForwardBranch({
        name: 'scenario/protected' as any,
        nextCommitId: COMMIT_B,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PERMISSION_DENIED',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ],
      },
    });

    await expect(
      version.deleteRef({
        name: 'scenario/protected' as any,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PERMISSION_DENIED',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ],
      },
    });

    await expect(
      version.createBranch({
        name: 'scenario/public-protected' as any,
        targetCommitId: COMMIT_A,
        protected: true,
      } as any),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({ option: 'protected' }),
            }),
          }),
        ],
      },
    });

    expect(branchService.readBranch('scenario/protected')).toMatchObject({
      ok: true,
      branch: {
        ref: {
          targetCommitId: COMMIT_A,
          refVersion: refVersion('0'),
        },
      },
    });
    expect(branchService.readBranch('scenario/public-protected')).toEqual({
      ok: true,
      branch: null,
      diagnostics: [],
    });
  });

  it('keeps tag-shaped and named immutable refs out of the branch mutation API', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();
    const createBranch = jest.spyOn(branchService, 'createBranch');
    const fastForwardBranch = jest.spyOn(branchService, 'fastForwardBranch');
    const deleteBranch = jest.spyOn(branchService, 'deleteBranch');

    await expect(
      version.createBranch({ name: 'refs/tags/v1.0.0' as any, targetCommitId: COMMIT_A }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({ refName: 'redacted' }),
            }),
          }),
        ]),
      },
    });
    await expect(
      version.fastForwardBranch({
        name: 'refs/tags/v1.0.0' as any,
        nextCommitId: COMMIT_B,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
          }),
        ]),
      },
    });
    await expect(
      version.deleteRef({
        name: 'refs/tags/v1.0.0' as any,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
          }),
        ]),
      },
    });

    expect(createBranch).not.toHaveBeenCalled();
    expect(fastForwardBranch).not.toHaveBeenCalled();
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it('requires detached/symbolic HEAD commits to choose a concrete branch ref', async () => {
    const commitWrite = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: { commit: commitWrite },
    } as any);

    await expect(
      version.commit({
        targetRef: 'HEAD' as any,
        expectedHead: {
          commitId: COMMIT_A,
          revision: refVersion('0'),
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({ option: 'targetRef' }),
            }),
          }),
        ],
      },
    });
    expect(commitWrite).not.toHaveBeenCalled();
  });

  it('rejects public delete without ref revision before service calls', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();
    const deleteBranch = jest.spyOn(branchService, 'deleteBranch');
    await version.createBranch({ name: 'scenario/delete-me' as any, targetCommitId: COMMIT_A });

    await expect(
      version.deleteRef({
        name: 'refs/heads/scenario/delete-me' as any,
        expectedHead: COMMIT_A,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({ option: 'expectedRefRevision' }),
            }),
          }),
        ],
      },
    });
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it('does not treat a raw ref store as a trusted public branch service', async () => {
    const refStore = createInMemoryRefStore({
      versionDocumentId: 'version-doc-1',
      now: () => '2026-06-20T00:00:00.000Z',
    });
    const main = refStore.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR });
    expect(main.ok).toBe(true);

    const version = new WorkbookVersionImpl({
      versioning: { refStore },
    } as any);

    await expect(version.listRefs()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_GRAPH_UNINITIALIZED' })],
      },
    });
  });
});
