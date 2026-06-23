import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import {
  COMMIT_A,
  COMMIT_B,
  COMMIT_C,
  createWorkbookVersionWithBranchService,
  refVersion,
} from './version-refs-test-utils';

describe('WorkbookVersion public ref compare-and-swap writes', () => {
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
              actualHead: 'redacted',
              actualRefRevision: 'redacted',
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
              actualHead: 'redacted',
              actualRefRevision: 'redacted',
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

  it('preflights last live branch deletes before calling the tombstone writer', async () => {
    const branch = {
      name: 'scenario/last',
      ref: {
        name: 'scenario/last',
        targetCommitId: COMMIT_A,
        refVersion: refVersion('0'),
      },
    };
    const branchService = {
      readBranch: jest.fn(async () => ({ ok: true, branch, diagnostics: [] })),
      listBranches: jest.fn(async () => ({ ok: true, branches: [branch], diagnostics: [] })),
      deleteBranch: jest.fn(),
    };
    const version = new WorkbookVersionImpl({ versioning: { branchService } } as any);

    await expect(
      version.deleteRef({
        name: 'scenario/last' as any,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REF_WRITE_UNAVAILABLE',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({ issue: 'lastLiveRef' }),
            }),
          }),
        ],
      },
    });
    expect(branchService.deleteBranch).not.toHaveBeenCalled();
  });
});
