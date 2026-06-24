import { expect, it } from '@jest/globals';

import {
  VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
  VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
} from '../version/revert/version-revert';
import {
  COMMIT_A,
  expectFailureDiagnosticsRedactedNoWrite,
  singleCommitInput,
  versionWithMutationGuards,
} from './version-revert-test-utils';

export function registerRevertAdmissionRedactionScenarios(): void {
  it('redacts failure diagnostics and omits caller-only revert details while leaving refs untouched', async () => {
    const { version, mutationGuards } = versionWithMutationGuards(
      {},
      { attachRevertService: false },
    );
    const callerOnlyRequestId = 'client-request-secret-123';
    const callerOnlyReason = 'sensitive revert narrative';
    const privateTargetRef = 'refs/heads/review/private-revert-subject';

    const result = await version.revert(
      {
        ...singleCommitInput(),
        targetRef: privateTargetRef as any,
        clientRequestId: callerOnlyRequestId,
        reason: callerOnlyReason,
      },
      { includeDiagnostics: true },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.revert',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              redacted: true,
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
          expect.objectContaining({
            code: VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              redacted: true,
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain(callerOnlyRequestId);
    expect(JSON.stringify(result)).not.toContain(callerOnlyReason);
    expect(JSON.stringify(result)).not.toContain(privateTargetRef);
    expect(JSON.stringify(result)).not.toContain(COMMIT_A);
    expectFailureDiagnosticsRedactedNoWrite(result, mutationGuards);
  });
}
