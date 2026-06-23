import { expect, it, jest } from '@jest/globals';

import {
  COMMIT_A,
  createWorkbookVersionWithBranchService,
  refVersion,
} from './version-refs-test-utils';

export function registerWriteGuardBranchPolicyRenameScenarios(): void {
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
}
