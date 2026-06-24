import { expect, it } from '@jest/globals';

import {
  historyDenialClassForCheckoutIssue,
  recoverabilityForCheckoutIssue,
  safeMessageForCheckoutIssue,
} from '../version/checkout/version-checkout-diagnostics';

export function registerCheckoutAccessDiagnosticsHistoryDenialClassificationScenarios(): void {
  it('classifies access, stale, and corrupt checkout history denials deterministically', () => {
    expect(
      [
        'VERSION_PERMISSION_DENIED',
        'VERSION_STALE_PAGE_CURSOR',
        'VERSION_REF_CONFLICT',
        'VERSION_DANGLING_REF',
        'VERSION_MISSING_OBJECT',
        'VERSION_OBJECT_STORE_FAILURE',
      ].map((issueCode) => ({
        issueCode,
        historyDenialClass: historyDenialClassForCheckoutIssue(issueCode),
        recoverability: recoverabilityForCheckoutIssue(issueCode),
        safeMessage: safeMessageForCheckoutIssue(issueCode),
      })),
    ).toEqual([
      {
        issueCode: 'VERSION_PERMISSION_DENIED',
        historyDenialClass: 'access-denied',
        recoverability: 'unsupported',
        safeMessage: 'Checkout is not authorized for the requested version target.',
      },
      {
        issueCode: 'VERSION_STALE_PAGE_CURSOR',
        historyDenialClass: 'stale-history',
        recoverability: 'retry',
        safeMessage: 'Checkout history metadata is stale and must be refreshed before checkout.',
      },
      {
        issueCode: 'VERSION_REF_CONFLICT',
        historyDenialClass: 'stale-history',
        recoverability: 'retry',
        safeMessage:
          'Checkout is blocked because the version ref changed during checkout planning.',
      },
      {
        issueCode: 'VERSION_DANGLING_REF',
        historyDenialClass: 'missing-graph-state',
        recoverability: 'repair',
        safeMessage:
          'Checkout cannot resolve the target because version history points at missing graph state.',
      },
      {
        issueCode: 'VERSION_MISSING_OBJECT',
        historyDenialClass: 'missing-graph-state',
        recoverability: 'repair',
        safeMessage:
          'Checkout cannot resolve the target because required version graph state is missing.',
      },
      {
        issueCode: 'VERSION_OBJECT_STORE_FAILURE',
        historyDenialClass: 'corrupt-graph-state',
        recoverability: 'repair',
        safeMessage:
          'Checkout cannot materialize the target because version graph state is corrupt or unsupported.',
      },
    ]);
  });
}
