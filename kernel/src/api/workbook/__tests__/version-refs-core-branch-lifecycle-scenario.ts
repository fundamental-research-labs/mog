import { expect, it } from '@jest/globals';

import {
  COMMIT_A,
  createWorkbookVersionWithBranchService,
  refVersion,
} from './version-refs-test-utils';

export function registerPublicBranchRefLifecycleScenario(): void {
  it('creates, reads, gets, and lists public branch refs through the attached service', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();

    await expect(
      version.createBranch({
        name: 'scenario/budget' as any,
        targetCommitId: COMMIT_A,
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        name: 'refs/heads/scenario/budget',
        commitId: COMMIT_A,
        revision: refVersion('0'),
        updatedAt: '2026-06-20T00:00:00.000Z',
      },
    });

    await expect(version.readRef('refs/heads/scenario/budget' as any)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'refs/heads/scenario/budget',
          commitId: COMMIT_A,
          revision: refVersion('0'),
        },
      },
    });

    await expect(version.getRef('scenario/budget' as any)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'refs/heads/scenario/budget',
          commitId: COMMIT_A,
        },
      },
    });

    await expect(version.getRef('HEAD')).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'HEAD',
          target: 'refs/heads/main',
          revision: refVersion('0'),
        },
        diagnostics: [],
      },
    });

    await expect(version.listRefs()).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({ name: 'refs/heads/main', commitId: COMMIT_A }),
          expect.objectContaining({ name: 'refs/heads/scenario/budget', commitId: COMMIT_A }),
        ],
        limit: 50,
      },
    });

    expect(branchService.readBranch('scenario/budget')).toMatchObject({
      ok: true,
      branch: {
        name: 'scenario/budget',
      },
    });
  });

  it('creates sibling refs without rebinding symbolic HEAD away from the current branch', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService('scenario/current');

    await expect(
      version.createBranch({
        name: 'scenario/current' as any,
        targetCommitId: COMMIT_A,
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(version.getRef('HEAD')).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'HEAD',
          target: 'refs/heads/scenario/current',
          revision: refVersion('0'),
        },
        diagnostics: [],
      },
    });

    await expect(
      version.createBranch({
        name: 'scenario/sibling' as any,
        targetCommitId: COMMIT_A,
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        name: 'refs/heads/scenario/sibling',
        commitId: COMMIT_A,
        revision: refVersion('0'),
        updatedAt: '2026-06-20T00:00:00.000Z',
      },
    });

    await expect(version.getRef('HEAD')).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'HEAD',
          target: 'refs/heads/scenario/current',
          revision: refVersion('0'),
        },
        diagnostics: [],
      },
    });
    await expect(version.getRef('scenario/current' as any)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'refs/heads/scenario/current',
          commitId: COMMIT_A,
          revision: refVersion('0'),
        },
      },
    });
    expect(branchService.getHead()).toMatchObject({
      ok: true,
      head: {
        branchName: 'scenario/current',
        commitId: COMMIT_A,
        refVersion: refVersion('0'),
      },
    });
  });
}
