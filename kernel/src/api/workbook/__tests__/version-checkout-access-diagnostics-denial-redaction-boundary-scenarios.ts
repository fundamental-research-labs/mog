import { expect, it } from '@jest/globals';

import { checkoutWorkbookVersion } from '../version-checkout';
import {
  createCtx,
  expectNoDiagnosticLeaks,
} from './version-checkout-access-diagnostics-test-utils';

export function registerCheckoutAccessDiagnosticsDenialRedactionBoundaryScenarios(): void {
  it('keeps access-filtered and corrupt graph checkout denials distinct and redacted', async () => {
    const commitId = `commit:sha256:${'8'.repeat(64)}` as const;
    const checkoutService = {
      checkout: async () => ({
        ok: false as const,
        error: {
          code: 'checkoutProviderUnavailable' as const,
          message: 'history read denied',
        },
        diagnostics: [
          {
            code: 'VERSION_STALE_PAGE_CURSOR' as const,
            severity: 'error' as const,
            message: 'stale cursor contains raw-ref-secret',
            refName: 'provider/raw-ref-secret',
            details: {
              cause: 'VERSION_STALE_PAGE_CURSOR',
            },
            sourceDiagnostics: [
              {
                code: 'VERSION_PERMISSION_DENIED',
                severity: 'error',
                message: 'principal-secret-stale cannot read raw-ref-secret',
              },
            ],
          },
          {
            code: 'VERSION_DANGLING_REF' as const,
            severity: 'corruption' as const,
            message: 'dangling ref raw-ref-secret',
            refName: 'provider/raw-ref-secret',
            commitId,
            details: {
              cause: 'VERSION_MISSING_OBJECT',
            },
          },
          {
            code: 'VERSION_PERMISSION_DENIED' as const,
            severity: 'error' as const,
            message: 'principal-secret-denied cannot read raw-ref-secret',
            refName: 'provider/raw-ref-secret',
            details: {
              cause: 'VERSION_PERMISSION_DENIED',
              accessCategory: 'historical-acl-unavailable',
              deniedPrincipalId: 'principal-secret-denied',
            },
          },
        ],
        mutationGuarantee: 'no-workbook-mutation' as const,
      }),
    };

    const result = await checkoutWorkbookVersion(createCtx({ checkoutService }), {
      kind: 'commit',
      id: commitId,
    });

    expect(result).toMatchObject({
      status: 'degraded',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_STALE_PAGE_CURSOR',
          recoverability: 'retry',
          severity: 'error',
          redacted: true,
          payload: expect.objectContaining({
            operation: 'checkout',
            targetKind: 'commit',
            commitId,
            refName: 'redacted',
            cause: 'VERSION_STALE_PAGE_CURSOR',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_DANGLING_REF',
          recoverability: 'repair',
          severity: 'error',
          redacted: true,
          payload: expect.objectContaining({
            operation: 'checkout',
            targetKind: 'commit',
            commitId,
            refName: 'redacted',
            cause: 'VERSION_MISSING_OBJECT',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_PERMISSION_DENIED',
          recoverability: 'unsupported',
          severity: 'error',
          redacted: true,
          payload: expect.objectContaining({
            operation: 'checkout',
            targetKind: 'commit',
            commitId,
            refName: 'redacted',
            cause: 'VERSION_PERMISSION_DENIED',
            accessCategory: 'historical-acl-unavailable',
          }),
        }),
      ],
      mutationGuarantee: 'no-workbook-mutation',
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.issueCode)).toEqual([
      'VERSION_STALE_PAGE_CURSOR',
      'VERSION_DANGLING_REF',
      'VERSION_PERMISSION_DENIED',
    ]);
    expectNoDiagnosticLeaks(result, [
      'raw-ref-secret',
      'principal-secret-stale',
      'principal-secret-denied',
    ]);
  });
}
