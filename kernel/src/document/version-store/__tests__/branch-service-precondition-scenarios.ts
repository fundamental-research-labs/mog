import {
  AUTHOR,
  COMMIT_A,
  COMMIT_B,
  createService,
  expectCreateOk,
} from './branch-service-test-helpers';

export function registerBranchPreconditionTests(): void {
  it('requires the expected old head for fast-forward updates', () => {
    const { service } = createService();
    const created = service.createBranch({
      name: 'scenario/missing-head',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expectCreateOk(created);

    const missingHead = service.fastForwardBranch({
      name: 'scenario/missing-head',
      nextCommitId: COMMIT_B,
      expectedRefVersion: created.branch.ref.refVersion,
      updatedBy: AUTHOR,
    });

    expect(missingHead.ok).toBe(false);
    if (missingHead.ok) throw new Error('expected missing expected head to fail');
    expect(missingHead.error.code).toBe('missingExpectedHead');
    expect(missingHead.diagnostics).toEqual([
      expect.objectContaining({
        code: 'missingExpectedHead',
        refName: 'scenario/missing-head',
        details: { missingField: 'expectedOldCommitId' },
      }),
    ]);
  });
}
