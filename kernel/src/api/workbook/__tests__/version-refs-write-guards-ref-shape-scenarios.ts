import { expect, it, jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import {
  COMMIT_A,
  COMMIT_B,
  createWorkbookVersionWithBranchService,
  refVersion,
} from './version-refs-test-utils';
import {
  expectBranchWritesNotCalled,
  spyOnBranchWrites,
} from './version-refs-write-guards-test-utils';

export function registerWriteGuardRefShapeScenarios(): void {
  it('keeps tag-shaped and named immutable refs out of the branch mutation API', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();
    const branchWrites = spyOnBranchWrites(branchService);

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

    expectBranchWritesNotCalled(branchWrites);
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
}
