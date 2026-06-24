import { expect, it } from '@jest/globals';

import { versionDocumentScopeKey } from '../../../document/version-store/provider';
import {
  checkoutRebindIdentityDiagnosticDetails,
  rebindVersioningAfterCheckout,
} from '../version/checkout/version-checkout-rebind';
import {
  captureError,
  createDocumentContext,
  expectDiagnosticDetailsNotToLeak,
  PROVIDER_DOCUMENT_ID,
} from './version-checkout-rebind-test-utils';

export function registerCheckoutRebindProviderIdentityScenarios(): void {
  it('rejects provider identity envelopes whose scope key and fields disagree', () => {
    const expectedScope = { documentId: PROVIDER_DOCUMENT_ID };
    const error = captureError(() =>
      rebindVersioningAfterCheckout({
        versioning: {
          provider: { documentScope: expectedScope },
          __mogCheckoutRebindIdentity: {
            schemaVersion: 1,
            providerDocumentScopeKey: versionDocumentScopeKey(expectedScope),
            providerDocumentId: 'provider-rebind-other-doc',
          },
        },
        nextContext: createDocumentContext(),
      }),
    );

    expect(checkoutRebindIdentityDiagnosticDetails(error)).toEqual({
      cause: 'VersionCheckoutRebindProviderIdentityError',
      identityFenceReason: 'providerIdentityEnvelopeMismatch',
      providerIdentityClass: 'scope',
    });
    expectDiagnosticDetailsNotToLeak(error, [
      PROVIDER_DOCUMENT_ID,
      'provider-rebind-other-doc',
      'providerDocumentScopeKey',
    ]);
  });
}
