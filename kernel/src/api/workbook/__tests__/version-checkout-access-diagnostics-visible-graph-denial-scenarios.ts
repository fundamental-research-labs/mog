import { expect, it } from '@jest/globals';

import { checkoutWorkbookVersion } from '../version-checkout';
import { createProviderBackedCheckoutMaterializationService } from '../../../document/version-store/checkout-provider-service';
import {
  createCtx,
  expectNoDiagnosticLeaks,
  initializeVersionGraph,
  providerWithDeniedOpenGraph,
} from './version-checkout-access-diagnostics-test-utils';

export function registerCheckoutAccessDiagnosticsVisibleGraphDenialScenarios(): void {
  it('redacts provider identity details when visible graph access is denied', async () => {
    const { provider } = await initializeVersionGraph();
    const checkoutService = createProviderBackedCheckoutMaterializationService({
      provider: providerWithDeniedOpenGraph(provider),
    });

    const result = await checkoutWorkbookVersion(createCtx({ checkoutService }), {
      kind: 'head',
    });

    expect(result).toMatchObject({
      status: 'degraded',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_PERMISSION_DENIED',
          recoverability: 'unsupported',
          payload: expect.objectContaining({
            operation: 'checkout',
            targetKind: 'head',
            refName: 'HEAD',
            cause: 'VERSION_PERMISSION_DENIED',
            accessCategory: 'permission-denied',
          }),
        }),
      ],
    });
    expectNoDiagnosticLeaks(result, ['workspace-secret-9', 'providerDocumentScopeKey']);
  });
}
