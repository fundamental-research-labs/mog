import { jest } from '@jest/globals';

import { createVersionWithBranchService } from './version-refs-provider-w8-redaction-test-helpers';
import {
  AUX_COMMIT_ID,
  SECRET_CAUSE,
  SECRET_ISSUE,
  SECRET_MESSAGE,
  SECRET_OPTION,
  SECRET_REF_NAME,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
  unsafeProviderFailure,
} from './version-refs-provider-w8-test-utils';

export function registerProviderW8RedactionProviderDiagnosticScenarios(): void {
  it('redacts unknown provider diagnostic detail tokens for create and delete failures', async () => {
    const branchService = {
      createBranch: jest.fn(async () => unsafeProviderFailure('createBranch')),
      deleteBranch: jest.fn(async () => unsafeProviderFailure('deleteBranch')),
    };
    const version = createVersionWithBranchService(branchService);

    const createFailed = await version.createBranch({
      name: SECRET_REF_NAME as any,
      targetCommitId: AUX_COMMIT_ID as any,
    });
    expectNoWriteFailure(createFailed, 'VERSION_REF_WRITE_UNAVAILABLE', {
      payload: expect.objectContaining({
        conflict: 'redacted',
        issue: 'redacted',
        option: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(
      createFailed,
      SECRET_REF_NAME,
      SECRET_ISSUE,
      SECRET_OPTION,
      SECRET_CAUSE,
      SECRET_MESSAGE,
    );

    const deleteFailed = await version.deleteRef({
      name: SECRET_REF_NAME as any,
      expectedHead: AUX_COMMIT_ID as any,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(deleteFailed, 'VERSION_REF_WRITE_UNAVAILABLE', {
      payload: expect.objectContaining({
        conflict: 'redacted',
        issue: 'redacted',
        option: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(
      deleteFailed,
      SECRET_REF_NAME,
      SECRET_ISSUE,
      SECRET_OPTION,
      SECRET_CAUSE,
      SECRET_MESSAGE,
    );
    expect(branchService.createBranch).toHaveBeenCalledTimes(1);
    expect(branchService.deleteBranch).toHaveBeenCalledTimes(1);
  });
}
