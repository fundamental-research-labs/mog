import { jest } from '@jest/globals';

import { createVersionWithBranchService } from './version-refs-provider-w8-redaction-test-helpers';
import {
  AUX_COMMIT_ID,
  SECRET_MESSAGE,
  SECRET_REF_NAME,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
  unsafeProviderFailure,
} from './version-refs-provider-w8-test-utils';

export function registerProviderW8RedactionActiveRefPreflightScenarios(): void {
  it.each([
    ['pending', { status: 'pending' }, 'activeCheckoutSessionPending'],
    [
      'failed',
      { status: 'failed', diagnostics: [unsafeProviderFailure('activeRef')] },
      'activeCheckoutSessionFailed',
    ],
  ])(
    'fails closed for %s active-ref provider reads before delete preflight',
    async (_label, active, _phase) => {
      const branchService = {
        readActiveCheckoutSession: jest.fn(async () => active),
        readBranch: jest.fn(),
        deleteBranch: jest.fn(),
      };
      const version = createVersionWithBranchService(branchService);

      const blocked = await version.deleteRef({
        name: SECRET_REF_NAME as any,
        expectedHead: AUX_COMMIT_ID as any,
        expectedRefRevision: { kind: 'counter', value: '0' },
      });
      expectNoWriteFailure(blocked, 'VERSION_PROVIDER_ERROR', {
        recoverability: 'retry',
        payload: expect.objectContaining({ phase: 'redacted' }),
      });
      expectNoDiagnosticLeak(blocked, SECRET_REF_NAME, SECRET_MESSAGE);
      expect(branchService.readBranch).not.toHaveBeenCalled();
      expect(branchService.deleteBranch).not.toHaveBeenCalled();
    },
  );
}
