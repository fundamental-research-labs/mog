import { expect, it } from '@jest/globals';

import {
  AUTHOR,
  COMMIT_A,
  COMMIT_B,
  createWorkbookVersionWithBranchService,
  refVersion,
} from './version-refs-test-utils';

export function registerWriteGuardBranchPolicyLifecycleScenarios(): void {
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
