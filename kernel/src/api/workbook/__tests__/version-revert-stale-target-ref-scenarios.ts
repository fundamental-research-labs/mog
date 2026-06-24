import { expect, it } from '@jest/globals';

import {
  VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
  VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
} from '../version/revert/version-revert';
import {
  COMMIT_B,
  COMMIT_C,
  MAIN_REF,
  MAIN_REVISION,
  expectDiagnosticCodes,
  expectFailureDiagnosticsRedactedNoWrite,
  singleCommitInput,
  versionWithMutationGuards,
} from './version-revert-test-utils';

export function registerRevertStaleTargetRefScenarios(): void {
  it('rejects stale target refs without attempting revert, commit, or ref mutation', async () => {
    const { version, mutationGuards } = versionWithMutationGuards(
      {},
      { attachRevertService: false },
    );

    const result = await version.revert(
      {
        ...singleCommitInput(),
        targetRef: MAIN_REF,
        expectedTargetHead: { commitId: COMMIT_B, revision: MAIN_REVISION },
        preflight: {
          staleHead: {
            refName: MAIN_REF,
            expectedCommitId: COMMIT_B,
            actualCommitId: COMMIT_C,
          },
        },
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
            code: VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                refName: MAIN_REF,
                expectedCommitId: COMMIT_B,
                actualCommitId: COMMIT_C,
              }),
            }),
          }),
          expect.objectContaining({
            code: VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                refName: MAIN_REF,
                reason: 'target-ref-cas',
                expectedHeadProvided: true,
              }),
            }),
          }),
        ]),
      },
    });
    expect(expectDiagnosticCodes(result)).not.toContain('VERSION_INVALID_OPTIONS');
    expectFailureDiagnosticsRedactedNoWrite(result, mutationGuards);
  });
}
