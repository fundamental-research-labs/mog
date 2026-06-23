import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import { COMMIT_A, refVersion } from './version-refs-test-utils';

export function registerWriteCasLastLiveDeleteScenarios(): void {
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
}
