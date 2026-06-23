import { jest } from '@jest/globals';

import { createVersionWithBranchService } from './version-refs-provider-w8-redaction-test-helpers';
import {
  AUX_COMMIT_ID,
  SECRET_MESSAGE,
  SECRET_REF_NAME,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
} from './version-refs-provider-w8-test-utils';

export function registerProviderW8RedactionTombstoneConflictScenarios(): void {
  it('projects tombstone incarnation mismatches as redacted create CAS conflicts', async () => {
    const branchService = {
      createBranch: jest.fn(async () => ({
        ok: false,
        diagnostics: [
          {
            code: 'expectedPreviousRefIncarnationIdMismatch',
            severity: 'error',
            message: SECRET_MESSAGE,
            commitId: AUX_COMMIT_ID,
            tombstoneRefVersion: { kind: 'counter', value: '4' },
            previousRefIncarnationId: 'secret-previous-incarnation',
            details: { expectedPreviousRefIncarnationId: 'secret-expected-incarnation' },
          },
        ],
      })),
    };
    const version = createVersionWithBranchService(branchService);

    const conflict = await version.createBranch({
      name: SECRET_REF_NAME as any,
      targetCommitId: AUX_COMMIT_ID as any,
    });
    expectNoWriteFailure(conflict, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
        conflict: 'expectedPreviousRefIncarnationIdMismatch',
      }),
    });
    expectNoDiagnosticLeak(
      conflict,
      SECRET_REF_NAME,
      SECRET_MESSAGE,
      'secret-previous-incarnation',
      'secret-expected-incarnation',
    );
  });
}
