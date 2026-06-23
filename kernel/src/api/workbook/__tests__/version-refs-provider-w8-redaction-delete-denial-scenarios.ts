import { jest } from '@jest/globals';

import { createVersionWithBranchService } from './version-refs-provider-w8-redaction-test-helpers';
import {
  AUX_COMMIT_ID,
  SECRET_CAUSE,
  SECRET_MESSAGE,
  SECRET_REF_NAME,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
  providerDeniedFailure,
} from './version-refs-provider-w8-test-utils';

export function registerProviderW8RedactionDeleteDenialScenarios(): void {
  it.each([
    ['returned', async () => providerDeniedFailure()],
    [
      'thrown',
      async () => {
        throw providerDeniedFailure();
      },
    ],
  ])(
    'redacts %s provider delete denials with a stable reason',
    async (_label, deleteBranchImpl) => {
      const branchService = {
        readBranch: jest.fn(async () => ({
          ok: true,
          branch: {
            name: SECRET_REF_NAME,
            ref: {
              targetCommitId: AUX_COMMIT_ID,
              refVersion: { kind: 'counter', value: '0' },
            },
          },
          diagnostics: [],
        })),
        deleteBranch: jest.fn(deleteBranchImpl),
      };
      const version = createVersionWithBranchService(branchService);

      const denied = await version.deleteRef({
        name: SECRET_REF_NAME as any,
        expectedHead: AUX_COMMIT_ID as any,
        expectedRefRevision: { kind: 'counter', value: '0' },
      });
      expectNoWriteFailure(denied, 'VERSION_PERMISSION_DENIED', {
        recoverability: 'unsupported',
        payload: expect.objectContaining({
          conflict: 'redacted',
          issue: 'providerDenied',
        }),
      });
      expectNoDiagnosticLeak(denied, SECRET_REF_NAME, SECRET_CAUSE, SECRET_MESSAGE);
      expect(branchService.readBranch).toHaveBeenCalledTimes(1);
      expect(branchService.deleteBranch).toHaveBeenCalledTimes(1);
    },
  );
}
