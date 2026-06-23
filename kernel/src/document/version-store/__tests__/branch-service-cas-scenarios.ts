import {
  AUTHOR,
  COMMIT_A,
  COMMIT_B,
  COMMIT_C,
  createService,
  expectCreateOk,
  expectFastForwardOk,
  refVersion,
} from './branch-service-test-helpers';

export function registerBranchCasTests(): void {
  it('returns duplicate branch conflicts from the ref store CAS record', () => {
    const { service } = createService();
    expectCreateOk(
      service.createBranch({
        name: 'scenario/duplicate',
        targetCommitId: COMMIT_A,
        expectedAbsent: true,
        createdBy: AUTHOR,
      }),
    );

    const duplicate = service.createBranch({
      name: 'scenario/duplicate',
      targetCommitId: COMMIT_B,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });

    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error('expected duplicate create to fail');
    expect(duplicate.error.code).toBe('refAlreadyExists');
    expect(duplicate.conflict).toMatchObject({
      code: 'refAlreadyExists',
      actualHead: COMMIT_A,
      actualRefVersion: refVersion('0'),
    });
  });

  it('fast-forwards with expected head and ref version and reports CAS conflicts', () => {
    const { service } = createService();
    const created = service.createBranch({
      name: 'scenario/advance',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expectCreateOk(created);

    const advanced = service.fastForwardBranch({
      name: 'scenario/advance',
      nextCommitId: COMMIT_B,
      expectedOldCommitId: COMMIT_A,
      expectedRefVersion: created.branch.ref.refVersion,
      updatedBy: AUTHOR,
    });
    expectFastForwardOk(advanced);
    expect(advanced.branch.ref).toMatchObject({
      targetCommitId: COMMIT_B,
      refVersion: refVersion('1'),
    });

    const staleHead = service.fastForwardBranch({
      name: 'scenario/advance',
      nextCommitId: COMMIT_C,
      expectedOldCommitId: COMMIT_A,
      expectedRefVersion: advanced.branch.ref.refVersion,
      updatedBy: AUTHOR,
    });
    expect(staleHead.ok).toBe(false);
    if (staleHead.ok) throw new Error('expected stale head update to fail');
    expect(staleHead.error.code).toBe('casConflict');
    expect(staleHead.diagnostics[0]).toMatchObject({
      code: 'casConflict',
      refName: 'scenario/advance',
      commitId: COMMIT_B,
      refVersion: refVersion('1'),
      details: { cause: 'expectedHeadMismatch' },
    });
    expect(staleHead.conflict).toMatchObject({
      code: 'expectedHeadMismatch',
      expectedHead: COMMIT_A,
      actualHead: COMMIT_B,
      actualRefVersion: refVersion('1'),
    });

    const staleRevision = service.fastForwardBranch({
      name: 'scenario/advance',
      nextCommitId: COMMIT_C,
      expectedOldCommitId: COMMIT_B,
      expectedRefVersion: created.branch.ref.refVersion,
      updatedBy: AUTHOR,
    });
    expect(staleRevision.ok).toBe(false);
    if (staleRevision.ok) throw new Error('expected stale refVersion update to fail');
    expect(staleRevision.error.code).toBe('casConflict');
    expect(staleRevision.conflict).toMatchObject({
      code: 'expectedRefVersionMismatch',
      expectedRefVersion: refVersion('0'),
      actualRefVersion: refVersion('1'),
      actualHead: COMMIT_B,
    });
  });
}
