import {
  AUTHOR,
  COMMIT_A,
  createService,
  expectCreateOk,
  expectListOk,
  expectReadOk,
  refVersion,
} from './branch-service-test-helpers';

export function registerBranchLifecycleTests(): void {
  it('creates, reads, and lists visible refs/heads branches', () => {
    const { service } = createService();

    const created = service.createBranch({
      name: 'refs/heads/scenario%2Fbudget',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expectCreateOk(created);
    expect(created.branch).toMatchObject({
      name: 'scenario/budget',
      refName: 'refs/heads/scenario%2Fbudget',
    });
    expect(created.branch.ref).toMatchObject({
      state: 'live',
      targetCommitId: COMMIT_A,
      refVersion: refVersion('0'),
    });

    const byUserName = service.readBranch('scenario/budget');
    expectReadOk(byUserName);
    expect(byUserName.branch?.refName).toBe('refs/heads/scenario%2Fbudget');

    const byRefName = service.readBranch('refs/heads/scenario/budget');
    expectReadOk(byRefName);
    expect(byRefName.branch?.name).toBe('scenario/budget');

    const absent = service.readBranch('scenario/missing');
    expectReadOk(absent);
    expect(absent.branch).toBeNull();

    const list = service.listBranches();
    expectListOk(list);
    expect(list.branches.map((branch) => branch.refName)).toEqual([
      'refs/heads/main',
      'refs/heads/scenario%2Fbudget',
    ]);
  });
}
