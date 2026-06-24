import { expect, it } from '@jest/globals';

import {
  checkoutRebindIdentityDiagnosticDetails,
  rebindVersioningAfterCheckout,
} from '../version/checkout/version-checkout-rebind';
import {
  BASE_COMMIT_ID,
  captureError,
  createDocumentContext,
  expectDiagnosticDetailsNotToLeak,
  MOVED_COMMIT_ID,
  SECRET_BRANCH,
} from './version-checkout-rebind-test-utils';

export function registerCheckoutRebindCurrentRefFallbackScenario(): void {
  it('rejects stale current ref evidence carried by the attached checkout session fallback', () => {
    const error = captureError(() =>
      rebindVersioningAfterCheckout({
        versioning: {
          versionSurfaceStatusService: {
            readActiveCheckoutSession: () => ({
              checkedOutCommitId: BASE_COMMIT_ID,
              detached: false,
              branchName: SECRET_BRANCH,
              refHeadAtMaterialization: BASE_COMMIT_ID,
              currentRefHeadId: MOVED_COMMIT_ID,
            }),
          },
        },
        nextContext: createDocumentContext(),
      }),
    );

    expect(checkoutRebindIdentityDiagnosticDetails(error)).toEqual({
      cause: 'VersionCheckoutRebindPriorCheckoutRefError',
      identityFenceReason: 'priorCheckoutRefStale',
      providerIdentityClass: 'ref',
    });
    expectDiagnosticDetailsNotToLeak(error, [BASE_COMMIT_ID, MOVED_COMMIT_ID, SECRET_BRANCH]);
  });
}
