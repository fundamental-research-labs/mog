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

    async function expectActiveHead() {
      await expect(version.getRef('HEAD')).resolves.toEqual({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'HEAD',
            target: 'refs/heads/scenario/active-delete',
            revision: refVersion('0'),
          },
          diagnostics: [],
        },
      });
    }

    await expectActiveHead();

    for (const [operation, deleteActiveBranch] of [
      [
        'deleteBranch',
        () =>
          version.deleteBranch({
            name: 'scenario/active-delete' as any,
            expectedHead: COMMIT_A,
            expectedRefRevision: refVersion('0'),
          }),
      ],
      [
        'deleteRef',
        () =>
          version.deleteRef({
            name: 'refs/heads/scenario/active-delete' as any,
            expectedHead: COMMIT_A,
            expectedRefRevision: refVersion('0'),
          }),
      ],
    ] as const) {
      const deleted = await deleteActiveBranch();

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
                  operation,
                }),
              }),
            }),
          ],
        },
      });
      await expectActiveHead();
    }

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
