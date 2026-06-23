import {
  COMMIT_A,
  COMMIT_B,
  COMMIT_C,
  createWorkbookVersionWithBranchService,
  refVersion,
} from './version-refs-test-utils';
import { expectRedactedExpectedHeadConflict } from './version-refs-write-cas-helpers';

export function registerWriteCasFastForwardScenarios(): void {
  it('fast-forwards and updateBranch aliases fast-forward with stale guards', async () => {
    const { branchService, version } = createWorkbookVersionWithBranchService();
    await version.createBranch({ name: 'scenario/advance' as any, targetCommitId: COMMIT_A });

    await expect(
      version.fastForwardBranch({
        name: 'scenario/advance' as any,
        nextCommitId: COMMIT_B,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/advance',
        commitId: COMMIT_B,
        revision: refVersion('1'),
      },
    });

    await expect(
      version.updateBranch({
        name: 'scenario/advance' as any,
        nextCommitId: COMMIT_C,
        expectedHead: COMMIT_B,
        expectedRefRevision: refVersion('1'),
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        name: 'refs/heads/scenario/advance',
        commitId: COMMIT_C,
        revision: refVersion('2'),
      },
    });

    const stale = await version.fastForwardBranch({
      name: 'scenario/advance' as any,
      nextCommitId: COMMIT_A,
      expectedHead: COMMIT_B,
      expectedRefRevision: refVersion('1'),
    });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: 'target_unavailable' },
    });
    if (stale.ok) throw new Error('expected stale fastForwardBranch to fail');
    expectRedactedExpectedHeadConflict(stale.error.diagnostics, {
      recoverability: 'retry',
    });

    expect(branchService.readBranch('scenario/advance')).toMatchObject({
      ok: true,
      branch: {
        ref: {
          targetCommitId: COMMIT_C,
          refVersion: refVersion('2'),
        },
      },
    });
  });
}
