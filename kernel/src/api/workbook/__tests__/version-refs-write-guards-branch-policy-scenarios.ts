import { expect, it, jest } from '@jest/globals';

import {
  AUTHOR,
  COMMIT_A,
  COMMIT_B,
  createWorkbookVersionWithBranchService,
  refVersion,
} from './version-refs-test-utils';
import { spyOnBranchWrites } from './version-refs-write-guards-test-utils';

export function registerWriteGuardBranchPolicyScenarios(): void {
  it('rejects invalid names and protected main mutations before service calls', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();
    const branchWrites = spyOnBranchWrites(branchService);

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
            payload: expect.objectContaining({
              refName: 'redacted',
              issue: 'containsUppercase',
            }),
          }),
        }),
      ]),
    );
    expect(branchWrites.createBranch).not.toHaveBeenCalled();

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
    expect(branchWrites.createBranch).not.toHaveBeenCalled();

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
    expect(branchWrites.fastForwardBranch).not.toHaveBeenCalled();

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
    expect(branchWrites.deleteBranch).not.toHaveBeenCalled();
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
              payload: expect.objectContaining({ option: 'redacted' }),
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
}
