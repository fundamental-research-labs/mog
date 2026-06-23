import { expect, it } from '@jest/globals';

import { checkoutWorkbookVersion } from '../version-checkout';
import {
  createCtx,
  expectNoDiagnosticLeaks,
} from './version-checkout-access-diagnostics-test-utils';

export function registerCheckoutAccessDiagnosticsPartialSnapshotFailureScenarios(): void {
  it('reports materializer failures after a partial snapshot as non-rollback-safe', async () => {
    const commitId = `commit:sha256:${'7'.repeat(64)}` as const;
    const checkoutService = {
      checkout: async () => ({
        ok: false as const,
        error: {
          code: 'checkoutSnapshotApplyFailed' as const,
          message: 'snapshot publish failed',
        },
        diagnostics: [
          {
            code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED' as const,
            severity: 'error' as const,
            message: 'raw providerDocumentScopeKey=provider-secret-doc',
            commitId,
            details: {
              cause: 'publishFailed',
              partialSnapshot: true,
              providerDocumentScopeKey: 'provider-secret-doc',
            },
          },
        ],
        mutationGuarantee: 'unknown-after-partial-mutation' as const,
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
          issueCode: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
          recoverability: 'repair',
          payload: expect.objectContaining({
            commitId,
            cause: 'publishFailed',
            partialSnapshot: true,
            mutationGuarantee: 'unknown-after-partial-mutation',
            rollbackSafe: false,
          }),
        }),
      ],
      mutationGuarantee: 'unknown-after-partial-mutation',
    });
    expectNoDiagnosticLeaks(result, ['provider-secret-doc', 'providerDocumentScopeKey']);
  });
}
