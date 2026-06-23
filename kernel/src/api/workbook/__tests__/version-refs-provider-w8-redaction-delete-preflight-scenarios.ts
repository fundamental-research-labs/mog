import { jest } from '@jest/globals';

import { createVersionWithBranchService } from './version-refs-provider-w8-redaction-test-helpers';
import {
  AUX_COMMIT_ID,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
} from './version-refs-provider-w8-test-utils';

export function registerProviderW8RedactionDeletePreflightScenarios(): void {
  it('rejects malformed delete ref names with redacted stable reasons before provider calls', async () => {
    const branchService = {
      readBranch: jest.fn(),
      deleteBranch: jest.fn(),
    };
    const version = createVersionWithBranchService(branchService);
    const malformedRefName = 'Scenario/Provider-Secret';

    const malformed = await version.deleteRef({
      name: malformedRefName as any,
      expectedHead: AUX_COMMIT_ID as any,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(malformed, 'VERSION_INVALID_OPTIONS', {
      payload: expect.objectContaining({
        issue: 'containsUppercase',
        refName: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(malformed, malformedRefName, 'Provider-Secret');
    expect(branchService.readBranch).not.toHaveBeenCalled();
    expect(branchService.deleteBranch).not.toHaveBeenCalled();
  });
}
