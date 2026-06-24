import { expect, it, jest } from '@jest/globals';

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

export function registerCheckoutRebindPriorRefScenarios(): void {
  it('rejects malformed prior checkout session refs restored on the materialized context', () => {
    const error = captureError(() =>
      rebindVersioningAfterCheckout({
        versioning: {},
        nextContext: createDocumentContext({
          versioning: {
            versionSurfaceStatusService: {
              readActiveCheckoutSession: () => ({
                checkedOutCommitId: BASE_COMMIT_ID,
                detached: false,
                branchName: SECRET_BRANCH,
              }),
            },
          },
        }),
      }),
    );

    expect(checkoutRebindIdentityDiagnosticDetails(error)).toEqual({
      cause: 'VersionCheckoutRebindPriorCheckoutRefError',
      identityFenceReason: 'priorCheckoutRefInvalid',
      providerIdentityClass: 'ref',
    });
    expectDiagnosticDetailsNotToLeak(error, [BASE_COMMIT_ID, SECRET_BRANCH]);
  });

  it('rejects stale prior checkout refs with redacted diagnostics', () => {
    const readRef = jest.fn(() => ({
      status: 'success',
      ref: {
        name: `refs/heads/${SECRET_BRANCH}`,
        commitId: MOVED_COMMIT_ID,
      },
    }));

    const error = captureError(() =>
      rebindVersioningAfterCheckout({
        versioning: {
          versionSurfaceStatusService: {
            readActiveCheckoutSession: () => ({
              checkedOutCommitId: BASE_COMMIT_ID,
              detached: false,
              branchName: SECRET_BRANCH,
              refHeadAtMaterialization: BASE_COMMIT_ID,
            }),
          },
          readService: { readRef },
        },
        nextContext: createDocumentContext(),
      }),
    );

    expect(readRef).toHaveBeenCalledWith(`refs/heads/${SECRET_BRANCH}`);
    expect(checkoutRebindIdentityDiagnosticDetails(error)).toEqual({
      cause: 'VersionCheckoutRebindPriorCheckoutRefError',
      identityFenceReason: 'priorCheckoutRefStale',
      providerIdentityClass: 'ref',
    });
    expectDiagnosticDetailsNotToLeak(error, [BASE_COMMIT_ID, MOVED_COMMIT_ID, SECRET_BRANCH]);
  });
}
