import {
  AUTHOR,
  COMMIT_A,
  COMMIT_B,
  createService,
  expectCreateOk,
  expectDeleteOk,
  refVersion,
} from './branch-service-test-helpers';

export function registerBranchDeleteTests(): void {
  it('deletes a branch with expected ref version and reports stale delete CAS conflicts', () => {
    const { service } = createService();
    const created = service.createBranch({
      name: 'scenario/delete-me',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expectCreateOk(created);

    const staleHead = service.deleteBranch({
      name: 'scenario/delete-me',
      expectedHead: COMMIT_B,
      expectedRefVersion: created.branch.ref.refVersion,
      deletedBy: AUTHOR,
    });
    expect(staleHead.ok).toBe(false);
    if (staleHead.ok) throw new Error('expected stale delete to fail');
    expect(staleHead.error.code).toBe('casConflict');
    expect(staleHead.conflict).toMatchObject({
      code: 'expectedHeadMismatch',
      expectedHead: COMMIT_B,
      actualHead: COMMIT_A,
      actualRefVersion: refVersion('0'),
    });

    const deleted = service.deleteBranch({
      name: 'refs/heads/scenario/delete-me',
      expectedHead: COMMIT_A,
      expectedRefVersion: created.branch.ref.refVersion,
      deletedBy: AUTHOR,
    });
    expectDeleteOk(deleted);
    expect(deleted.branch).toMatchObject({
      name: 'scenario/delete-me',
      refName: 'refs/heads/scenario%2Fdelete-me',
      ref: {
        state: 'tombstone',
        previousTargetCommitId: COMMIT_A,
        refVersion: refVersion('1'),
      },
    });

    const readDeleted = service.readBranch('scenario/delete-me');
    expect(readDeleted.ok).toBe(false);
    if (readDeleted.ok) throw new Error('expected tombstoned branch read to fail');
    expect(readDeleted.error.code).toBe('refTombstoned');
  });
}
