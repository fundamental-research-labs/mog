import { expect, it } from '@jest/globals';

import { checkoutWorkbookVersion } from '../version-checkout';
import { createProviderBackedCheckoutMaterializationService } from '../../../document/version-store/checkout-provider-service';
import {
  createCtx,
  expectNoDiagnosticLeaks,
  initializeVersionGraph,
  providerWithDeniedRef,
} from './version-checkout-access-diagnostics-test-utils';

export function registerCheckoutAccessDiagnosticsSubsetRefRedactionScenarios(): void {
  it('redacts provider-backed access-denied subset ref diagnostics', async () => {
    const { provider } = await initializeVersionGraph();
    const deniedProvider = providerWithDeniedRef(provider, 'refs/heads/scenario/subset-hidden');
    const checkoutService = createProviderBackedCheckoutMaterializationService({
      provider: deniedProvider,
    });

    const result = await checkoutWorkbookVersion(createCtx({ checkoutService }), {
      kind: 'ref',
      name: 'refs/heads/scenario/subset-hidden' as any,
    });

    expect(result).toMatchObject({
      status: 'degraded',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_PERMISSION_DENIED',
          recoverability: 'unsupported',
          redacted: true,
          payload: expect.objectContaining({
            operation: 'checkout',
            targetKind: 'ref',
            refName: 'refs/heads/scenario/subset-hidden',
            cause: 'VERSION_PERMISSION_DENIED',
            accessCategory: 'subset-hidden',
          }),
        }),
      ],
      mutationGuarantee: 'no-workbook-mutation',
    });
    expectNoDiagnosticLeaks(result, ['principal-secret-7', 'hidden-sheet-42']);
  });
}
