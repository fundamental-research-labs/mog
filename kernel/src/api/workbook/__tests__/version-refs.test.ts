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

function createWorkbookVersionWithBranchService() {
  const refStore = createInMemoryRefStore({
    versionDocumentId: 'version-doc-1',
    now: () => '2026-06-20T00:00:00.000Z',
  });
  const main = refStore.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR });
  expect(main.ok).toBe(true);
  if (!main.ok) throw new Error(`expected main initialization: ${main.error.code}`);

  const branchService = createInMemoryBranchService({ refStore });
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
      status: 'degraded',
      ref: null,
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_WRITE_UNAVAILABLE',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
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
      status: 'success',
      ref: {
        name: 'refs/heads/scenario/budget',
        commitId: COMMIT_A,
        revision: refVersion('0'),
        updatedAt: '2026-06-20T00:00:00.000Z',
      },
      diagnostics: [],
    });

    await expect(version.readRef('refs/heads/scenario/budget' as any)).resolves.toMatchObject({
      status: 'success',
      ref: {
        name: 'refs/heads/scenario/budget',
        commitId: COMMIT_A,
        revision: refVersion('0'),
      },
    });

    await expect(version.getRef('scenario/budget' as any)).resolves.toMatchObject({
      status: 'success',
      ref: {
        name: 'refs/heads/scenario/budget',
        commitId: COMMIT_A,
      },
    });

    await expect(version.getRef('HEAD')).resolves.toEqual({
      status: 'success',
      ref: {
        name: 'HEAD',
        target: 'refs/heads/main',
        revision: refVersion('0'),
      },
      diagnostics: [],
    });

    await expect(version.listRefs()).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({ name: 'refs/heads/main', commitId: COMMIT_A }),
          expect.objectContaining({ name: 'refs/heads/scenario/budget', commitId: COMMIT_A }),
        ],
      },
    });

    expect(branchService.readBranch('scenario/budget')).toMatchObject({
      ok: true,
      branch: {
        name: 'scenario/budget',
      },
    });
  });

  it('filters listRefs by namespace and branch prefix without mutating state', async () => {
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

    const filtered = await version.listRefs({ prefix: 'refs/heads/scenario/forecast' as any });
    expect(filtered).toMatchObject({
      ok: true,
      value: {
        items: [expect.objectContaining({ name: 'refs/heads/scenario/forecast/q1' })],
      },
    });
    expect(filtered.ok && filtered.value.items).toHaveLength(1);

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
  });

  it('rejects invalid names and protected main mutations before service calls', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();
    const createBranch = jest.spyOn(branchService, 'createBranch');
    const fastForwardBranch = jest.spyOn(branchService, 'fastForwardBranch');

    const invalidName = await version.createBranch({
      name: 'Scenario/Budget' as any,
      targetCommitId: COMMIT_A,
    });
    expect(invalidName).toMatchObject({ status: 'degraded' });
    expect(invalidName.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_INVALID_OPTIONS',
          payload: expect.objectContaining({ refName: 'redacted', issue: 'containsUppercase' }),
        }),
      ]),
    );
    expect(createBranch).not.toHaveBeenCalled();

    await expect(
      version.createBranch({ name: 'main' as any, targetCommitId: COMMIT_A }),
    ).resolves.toMatchObject({
      status: 'degraded',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_PERMISSION_DENIED',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
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
      status: 'degraded',
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_PERMISSION_DENIED' })],
    });
    expect(fastForwardBranch).not.toHaveBeenCalled();
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
      status: 'success',
      ref: {
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
      status: 'success',
      ref: {
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
    expect(stale).toMatchObject({ status: 'degraded' });
    expect(stale.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          recoverability: 'retry',
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

  it('reports unsupported delete paths without mutating branch service state', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();
    await version.createBranch({ name: 'scenario/delete-me' as any, targetCommitId: COMMIT_A });

    await expect(
      version.deleteBranch({
        name: 'scenario/delete-me' as any,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      status: 'degraded',
      ref: null,
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_WRITE_UNAVAILABLE',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
    });

    await expect(version.deleteRef({ name: 'refs/heads/scenario/delete-me' as any })).resolves
      .toMatchObject({
        status: 'degraded',
        diagnostics: [expect.objectContaining({ issueCode: 'VERSION_REF_WRITE_UNAVAILABLE' })],
      });

    expect(branchService.readBranch('scenario/delete-me')).toMatchObject({
      ok: true,
      branch: {
        ref: {
          targetCommitId: COMMIT_A,
          refVersion: refVersion('0'),
        },
      },
    });
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
