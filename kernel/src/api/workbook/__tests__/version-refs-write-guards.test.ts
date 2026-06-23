import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import {
  AUTHOR,
  COMMIT_A,
  COMMIT_B,
  createWorkbookVersionWithBranchService,
  refVersion,
} from './version-refs-test-utils';

describe('WorkbookVersion public ref write guards', () => {
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

  it('rejects non-canonical public ref revisions before service calls', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();
    await version.createBranch({ name: 'scenario/bad-revision' as any, targetCommitId: COMMIT_A });
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
});
