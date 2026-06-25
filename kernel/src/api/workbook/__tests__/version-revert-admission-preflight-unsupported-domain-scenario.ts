import { expect, it } from '@jest/globals';

import { VERSION_REVERT_UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODE } from '../version/revert/version-revert';
import {
  expectFailureDiagnosticsRedactedNoWrite,
  singleCommitInput,
  versionWithMutationGuards,
} from './version-revert-test-utils';

export function registerRevertAdmissionUnsupportedDomainScenario(): void {
  it('rejects unsupported merge-domain revert without attempting commit or ref mutation', async () => {
    const { version, mutationGuards } = versionWithMutationGuards();

    const result = await version.revert(
      {
        ...singleCommitInput(),
        preflight: {
          unsupportedDomains: [
            {
              domain: 'view-state',
              matrixRowId: 'view-state.selection-scroll',
              reason: 'unsupportedMergeDomain',
            },
          ],
        },
      },
      { dryRun: true, includeDiagnostics: true },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.revert',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: VERSION_REVERT_UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                domain: 'view-state',
                matrixRowId: 'view-state.selection-scroll',
                reason: 'unsupportedMergeDomain',
              }),
            }),
          }),
        ]),
      },
    });
    expectFailureDiagnosticsRedactedNoWrite(result, mutationGuards);
  });
}
