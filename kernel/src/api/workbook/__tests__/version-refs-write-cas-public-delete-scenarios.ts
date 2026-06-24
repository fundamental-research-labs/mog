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

  it('deletes non-current refs without rebinding HEAD or changing the current branch', async () => {
    const { branchService, version } =
      createWorkbookVersionWithBranchService('scenario/current-delete');
    await version.createBranch({
      name: 'scenario/current-delete' as any,
      targetCommitId: COMMIT_A,
    });
    await version.createBranch({
      name: 'scenario/delete-non-current' as any,
      targetCommitId: COMMIT_A,
    });

    await expect(version.getRef('HEAD')).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'HEAD',
          target: 'refs/heads/scenario/current-delete',
          revision: refVersion('0'),
        },
        diagnostics: [],
      },
    });

    await expect(
      version.deleteRef({
        name: 'refs/heads/scenario/delete-non-current' as any,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/delete-non-current',
        commitId: COMMIT_A,
        revision: refVersion('1'),
      },
    });

    await expect(version.getRef('HEAD')).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'HEAD',
          target: 'refs/heads/scenario/current-delete',
          revision: refVersion('0'),
        },
        diagnostics: [],
      },
    });
    await expect(version.getRef('scenario/current-delete' as any)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'refs/heads/scenario/current-delete',
          commitId: COMMIT_A,
          revision: refVersion('0'),
        },
      },
    });

    const scenarioRefs = await version.listRefs({ prefix: 'refs/heads/scenario' as any });
    expect(scenarioRefs).toMatchObject({
      ok: true,
      value: {
        items: [expect.objectContaining({ name: 'refs/heads/scenario/current-delete' })],
      },
    });
    expect(scenarioRefs.ok).toBe(true);
    if (!scenarioRefs.ok) throw new Error('expected listRefs success');
    expect(scenarioRefs.value.items.map((ref) => ref.name)).not.toContain(
      'refs/heads/scenario/delete-non-current',
    );
    expect(branchService.readBranch('scenario/current-delete')).toMatchObject({
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
}
