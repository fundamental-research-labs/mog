import {
  COMMIT_A,
  COMMIT_B,
  createWorkbookVersionWithBranchService,
  refVersion,
} from './version-refs-test-utils';
import { expectRedactedExpectedHeadConflict } from './version-refs-write-cas-helpers';

export function registerWriteCasPublicDeleteScenarios(): void {
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
    expectRedactedExpectedHeadConflict(staleDelete.error.diagnostics);

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
}
