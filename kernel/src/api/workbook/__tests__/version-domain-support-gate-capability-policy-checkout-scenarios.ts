import { expect, it, jest } from '@jest/globals';

import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { WorkbookVersionImpl } from '../version';
import { BASE } from './version-domain-support-gate-test-helpers';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainCapabilityStates as capabilityStates,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

export function registerDomainSupportCapabilityPolicyCheckoutScenarios(): void {
  it('blocks checkout based on checkout capability state', async () => {
    const checkout = jest.fn();
    const planCheckout = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        checkoutService: { checkout, planCheckout },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'sheets'
              ? domainRow(id, {
                  capabilityStates: {
                    ...capabilityStates(),
                    checkout: 'not-started',
                  },
                })
              : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW },
      },
    } as any);

    await expect(version.checkout({ kind: 'commit', id: BASE })).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.checkout',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'checkout',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                diagnosticCode: 'capability-state-blocked',
                domainId: 'sheets',
                capabilityKey: 'checkout',
                capabilityState: 'not-started',
              }),
            }),
          }),
        ]),
      },
    });
    expect(checkout).not.toHaveBeenCalled();
    expect(planCheckout).not.toHaveBeenCalled();
  });
}
