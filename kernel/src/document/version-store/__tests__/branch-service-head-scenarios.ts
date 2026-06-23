import {
  AUTHOR,
  COMMIT_A,
  createService,
  expectHeadOk,
  refVersion,
} from './branch-service-test-helpers';

export function registerBranchHeadTests(): void {
  it('reports symbolic HEAD state and rejects detached HEAD creation', () => {
    const { service } = createService();

    const head = service.getHead();
    expectHeadOk(head);
    expect(head.head).toEqual({
      mode: 'attached',
      refName: 'refs/heads/main',
      branchName: 'main',
      commitId: COMMIT_A,
      refVersion: refVersion('0'),
      refIncarnationId: expect.any(String),
    });

    const createHead = service.createBranch({
      name: 'HEAD',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(createHead.ok).toBe(false);
    if (createHead.ok) throw new Error('expected HEAD branch create to fail');
    expect(createHead.error.code).toBe('unsupportedDetachedHead');

    const detached = service.createDetachedHead({ commitId: COMMIT_A });
    expect(detached.ok).toBe(false);
    expect(detached.error.code).toBe('unsupportedDetachedHead');
    expect(detached.diagnostics[0]).toMatchObject({
      code: 'unsupportedDetachedHead',
      commitId: COMMIT_A,
    });
  });
}
