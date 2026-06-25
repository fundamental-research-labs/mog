import { expect, it, jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import {
  COMMIT_A,
  COMMIT_B,
  createWorkbookVersionWithBranchService,
  refVersion,
} from './version-refs-test-utils';

export function registerWriteGuardRevisionScenarios(): void {
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

  it('rejects non-canonical public ref revisions before service calls', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();
    await version.createBranch({
      name: 'scenario/bad-revision' as any,
      targetCommitId: COMMIT_A,
    });
    const fastForwardBranch = jest.spyOn(branchService, 'fastForwardBranch');
    const deleteBranch = jest.spyOn(branchService, 'deleteBranch');

    for (const operation of [
      version.fastForwardBranch({
        name: 'scenario/bad-revision' as any,
        nextCommitId: COMMIT_B,
        expectedHead: COMMIT_A,
        expectedRefRevision: { kind: 'counter', value: '01' },
      } as any),
      version.deleteRef({
        name: 'scenario/bad-revision' as any,
        expectedHead: COMMIT_A,
        expectedRefRevision: { kind: 'counter', value: '' },
      } as any),
    ]) {
      await expect(operation).resolves.toMatchObject({
        ok: false,
        error: {
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
    }
    expect(fastForwardBranch).not.toHaveBeenCalled();
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it('rejects provider ref records with inconsistent revision fields', async () => {
    const branchService = {
      readBranch: jest.fn(async () => ({
        ok: true,
        branch: {
          name: 'scenario/inconsistent-revision',
          ref: {
            targetCommitId: COMMIT_A,
            refVersion: refVersion('2'),
            revision: refVersion('1'),
          },
        },
        diagnostics: [],
      })),
    };
    const version = new WorkbookVersionImpl({ versioning: { branchService } } as any);

    await expect(version.readRef('scenario/inconsistent-revision' as any)).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
            data: expect.objectContaining({ redacted: true }),
          }),
        ],
      },
    });
  });
}
