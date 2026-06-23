import { expect, it } from '@jest/globals';

import {
  COMMIT_A,
  COMMIT_B,
  createWorkbookVersionWithBranchService,
  refVersion,
} from './version-refs-test-utils';
import { spyOnBranchWrites } from './version-refs-write-guards-test-utils';

export function registerWriteGuardBranchPolicyInvalidProtectedScenarios(): void {
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
}
