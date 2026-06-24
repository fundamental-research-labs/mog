import { createInMemoryBranchService } from '../branch-service';
import {
  AUTHOR,
  COMMIT_A,
  COMMIT_B,
  createService,
  expectCreateOk,
  expectDeleteOk,
  expectFastForwardOk,
  expectListOk,
  expectReadOk,
  refVersion,
} from './branch-service-test-helpers';

export function registerBranchDeleteTests(): void {
  it('rejects deleting the current symbolic HEAD before store-level delete checks', () => {
    const { refStore, service, main } = createService();

    const deleteMain = service.deleteBranch({
      name: 'main',
      deletedBy: AUTHOR,
    });
    expect(deleteMain.ok).toBe(false);
    if (deleteMain.ok) throw new Error('expected current main delete to fail');
    expect(deleteMain.error.code).toBe('activeRef');
    expect(deleteMain.diagnostics).toEqual([
      expect.objectContaining({
        code: 'activeRef',
        refName: 'main',
        details: { issue: 'activeBranchDelete' },
      }),
    ]);

    const mainAfterDeniedDelete = refStore.getRef('main');
    expect(mainAfterDeniedDelete.ok).toBe(true);
    if (!mainAfterDeniedDelete.ok) throw new Error('expected main to remain live');
    expect(mainAfterDeniedDelete.ref).toMatchObject({
      state: 'live',
      name: 'main',
      refVersion: main.refVersion,
    });

    const currentBranch = service.createBranch({
      name: 'scenario/current',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expectCreateOk(currentBranch);

    const currentService = createInMemoryBranchService({
      refStore,
      headRefName: 'refs/heads/scenario%2Fcurrent',
    });
    const deleteCurrent = currentService.deleteBranch({
      name: 'scenario/current',
      expectedHead: COMMIT_A,
      expectedRefVersion: currentBranch.branch.ref.refVersion,
      deletedBy: AUTHOR,
    });
    expect(deleteCurrent.ok).toBe(false);
    if (deleteCurrent.ok) throw new Error('expected current branch delete to fail');
    expect(deleteCurrent.error.code).toBe('activeRef');

    const readCurrent = currentService.readBranch('scenario/current');
    expectReadOk(readCurrent);
    expect(readCurrent.branch?.ref).toMatchObject({
      state: 'live',
      name: 'scenario/current',
      refVersion: currentBranch.branch.ref.refVersion,
    });

    const detachedService = createInMemoryBranchService({ refStore, headRefName: null });
    expectDeleteOk(
      detachedService.deleteBranch({
        name: 'scenario/current',
        expectedHead: COMMIT_A,
        expectedRefVersion: currentBranch.branch.ref.refVersion,
        deletedBy: AUTHOR,
      }),
    );
  });

  it('deletes a branch with expected ref version and reports stale delete CAS conflicts', () => {
    const { refStore, service } = createService();
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

    const advanced = service.fastForwardBranch({
      name: 'scenario/delete-me',
      nextCommitId: COMMIT_B,
      expectedOldCommitId: COMMIT_A,
      expectedRefVersion: created.branch.ref.refVersion,
      updatedBy: AUTHOR,
    });
    expectFastForwardOk(advanced);

    const staleRevision = service.deleteBranch({
      name: 'scenario/delete-me',
      expectedHead: COMMIT_B,
      expectedRefVersion: created.branch.ref.refVersion,
      deletedBy: AUTHOR,
    });
    expect(staleRevision.ok).toBe(false);
    if (staleRevision.ok) throw new Error('expected stale delete revision to fail');
    expect(staleRevision.error.code).toBe('casConflict');
    expect(staleRevision.diagnostics[0]).toMatchObject({
      code: 'casConflict',
      refName: 'scenario/delete-me',
      commitId: COMMIT_B,
      refVersion: refVersion('1'),
      details: { cause: 'expectedRefVersionMismatch' },
    });
    expect(staleRevision.conflict).toMatchObject({
      code: 'expectedRefVersionMismatch',
      expectedRefVersion: refVersion('0'),
      actualRefVersion: refVersion('1'),
      actualHead: COMMIT_B,
    });

    const stillLive = service.readBranch('scenario/delete-me');
    expectReadOk(stillLive);
    expect(stillLive.branch?.ref).toMatchObject({
      state: 'live',
      targetCommitId: COMMIT_B,
      refVersion: refVersion('1'),
    });

    const deleted = service.deleteBranch({
      name: 'refs/heads/scenario/delete-me',
      expectedHead: COMMIT_B,
      expectedRefVersion: advanced.branch.ref.refVersion,
      deletedBy: AUTHOR,
    });
    expectDeleteOk(deleted);
    expect(deleted.branch).toMatchObject({
      name: 'scenario/delete-me',
      refName: 'refs/heads/scenario%2Fdelete-me',
      ref: {
        state: 'tombstone',
        previousTargetCommitId: COMMIT_B,
        refVersion: refVersion('2'),
      },
    });

    const readDeleted = service.readBranch('scenario/delete-me');
    expect(readDeleted.ok).toBe(false);
    if (readDeleted.ok) throw new Error('expected tombstoned branch read to fail');
    expect(readDeleted.error.code).toBe('refTombstoned');

    const liveBranches = service.listBranches();
    expectListOk(liveBranches);
    expect(liveBranches.branches.map((branch) => branch.name)).toEqual(['main']);

    const deletedRef = refStore.getRef('scenario/delete-me', { includeTombstone: true });
    expect(deletedRef.ok).toBe(true);
    if (!deletedRef.ok) throw new Error('expected tombstone read to succeed');
    expect(deletedRef.ref).toMatchObject({
      state: 'tombstone',
      name: 'scenario/delete-me',
      previousTargetCommitId: COMMIT_B,
      refVersion: refVersion('2'),
    });
  });
}
