import {
  COMMIT_A,
  createWorkbookVersionWithBranchService,
  refVersion,
} from './version-refs-test-utils';

export function registerWriteCasActiveDeleteScenarios(): void {
  it('blocks deleting the active branch before tombstoning the current head', async () => {
    const { branchService, version } =
      createWorkbookVersionWithBranchService('scenario/active-delete');
    await version.createBranch({
      name: 'scenario/active-delete' as any,
      targetCommitId: COMMIT_A,
    });

    const deleted = await version.deleteBranch({
      name: 'scenario/active-delete' as any,
      expectedHead: COMMIT_A,
      expectedRefRevision: refVersion('0'),
    });

    expect(deleted).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REF_WRITE_UNAVAILABLE',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                issue: 'activeBranchDelete',
                operation: 'deleteBranch',
              }),
            }),
          }),
        ],
      },
    });
    expect(branchService.readBranch('scenario/active-delete')).toMatchObject({
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
