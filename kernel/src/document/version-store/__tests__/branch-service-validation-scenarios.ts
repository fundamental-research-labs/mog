import { createInMemoryBranchService } from '../branch-service';
import {
  AUTHOR,
  COMMIT_A,
  createService,
  expectListOk,
  fakeListOnlyStore,
  fakeLiveRef,
} from './branch-service-test-helpers';

export function registerBranchValidationTests(): void {
  it('rejects reserved namespaces and filters reserved rows from visible listings', () => {
    const { service } = createService();

    const reservedCreate = service.createBranch({
      name: 'refs/system/secret',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(reservedCreate.ok).toBe(false);
    if (reservedCreate.ok) throw new Error('expected reserved namespace create to fail');
    expect(reservedCreate.error.code).toBe('reservedNamespace');
    expect(reservedCreate.diagnostics).toEqual([
      expect.objectContaining({
        code: 'reservedNamespace',
        details: { namespace: 'refs/system' },
      }),
    ]);

    const fakeStore = fakeListOnlyStore([
      fakeLiveRef('scenario/visible'),
      fakeLiveRef('refs/system/hidden'),
      fakeLiveRef('refs/imports/hidden'),
    ]);
    const filteredService = createInMemoryBranchService({ refStore: fakeStore });
    const list = filteredService.listBranches();
    expectListOk(list);
    expect(list.branches.map((branch) => branch.name)).toEqual(['scenario/visible']);
    expect(list.diagnostics.map((item) => item.code)).toEqual([
      'reservedNamespace',
      'reservedNamespace',
    ]);
  });

  it('returns invalid ref diagnostics from ref-name validation', () => {
    const { service } = createService();

    const uppercase = service.createBranch({
      name: 'Scenario/Budget',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(uppercase.ok).toBe(false);
    if (uppercase.ok) throw new Error('expected uppercase ref to fail');
    expect(uppercase.error.code).toBe('invalidRefName');
    expect(uppercase.diagnostics.map((item) => item.code)).toContain('refName.containsUppercase');

    const badEncoding = service.createBranch({
      name: 'refs/heads/scenario%ZZ',
      targetCommitId: COMMIT_A,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(badEncoding.ok).toBe(false);
    if (badEncoding.ok) throw new Error('expected bad encoded ref to fail');
    expect(badEncoding.error.code).toBe('invalidRefName');
    expect(badEncoding.diagnostics).toEqual([
      expect.objectContaining({
        code: 'invalidRefName',
        message: 'refs/heads/* branch ref contains invalid percent encoding.',
      }),
    ]);
  });
}
