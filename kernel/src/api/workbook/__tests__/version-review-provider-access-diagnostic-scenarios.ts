import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import {
  HEAD_COMMIT_ID,
  PRINCIPAL_SECRET,
  RAW_CELL_VALUE,
  SECRET_BRANCH,
  SECRET_DOMAIN,
  SECRET_PATH,
  SECRET_REF,
  expectNoDiagnosticLeaks,
} from './version-review-provider-access-test-utils';
import { sanitizeReviewAccessDiagnostics } from '../../../document/version-store/review-access-projection';

export function registerReviewProviderAccessDiagnosticScenarios(): void {
  it('redacts raw values from provider review projection diagnostics', () => {
    const diagnostics = sanitizeReviewAccessDiagnostics([
      {
        code: 'VERSION_PERMISSION_DENIED',
        severity: 'error',
        message: `Denied ${PRINCIPAL_SECRET}.`,
        data: {
          payload: {
            deniedCapabilities: ['version:reviewRead'],
            principalScope: PRINCIPAL_SECRET,
            domain: SECRET_DOMAIN,
            path: SECRET_PATH,
            value: RAW_CELL_VALUE,
            cellValue: RAW_CELL_VALUE,
            publicReason: 'accessDenied',
          },
        },
      },
    ] satisfies readonly VersionDiagnostic[]);

    expect(diagnostics).toMatchObject([
      {
        code: 'VERSION_PERMISSION_DENIED',
        message: 'Denied redacted-principal.',
        data: {
          payload: expect.objectContaining({
            deniedCapabilities: ['version:reviewRead'],
            publicReason: 'accessDenied',
          }),
        },
      },
    ]);
    expectNoDiagnosticLeaks(diagnostics, [
      PRINCIPAL_SECRET,
      SECRET_DOMAIN,
      SECRET_PATH,
      RAW_CELL_VALUE,
      'principalScope',
      '"domain"',
      '"path"',
      '"value"',
      '"cellValue"',
    ]);
  });

  it('redacts hidden branch and ref diagnostics while preserving capability state', () => {
    const diagnostics = sanitizeReviewAccessDiagnostics([
      {
        code: 'VERSION_PERMISSION_DENIED',
        severity: 'error',
        message: `Capability state denied ${PRINCIPAL_SECRET} for ref ${SECRET_REF} branchName=${SECRET_BRANCH}.`,
        data: {
          payload: {
            capability: 'version:reviewRead',
            deniedCapabilities: ['version:reviewRead'],
            dependency: 'hostCapability',
            retryable: false,
            reason: 'hostCapabilityDenied',
            principalScope: PRINCIPAL_SECRET,
            targetRef: SECRET_REF,
            refName: SECRET_REF,
            branchName: SECRET_BRANCH,
            expectedTargetHead: {
              commitId: HEAD_COMMIT_ID,
              revision: 'rv:w10-09-secret',
            },
          },
        },
      },
    ] satisfies readonly VersionDiagnostic[]);

    expect(diagnostics).toMatchObject([
      {
        code: 'VERSION_PERMISSION_DENIED',
        message: 'Capability state denied redacted-principal for ref redacted-ref redacted-ref.',
        data: {
          payload: {
            capability: 'version:reviewRead',
            deniedCapabilities: ['version:reviewRead'],
            dependency: 'hostCapability',
            retryable: false,
            reason: 'hostCapabilityDenied',
          },
        },
      },
    ]);
    expectNoDiagnosticLeaks(diagnostics, [
      PRINCIPAL_SECRET,
      SECRET_REF,
      SECRET_BRANCH,
      HEAD_COMMIT_ID,
      'principalScope',
      'targetRef',
      'refName',
      'branchName',
      'expectedTargetHead',
    ]);
  });
}
