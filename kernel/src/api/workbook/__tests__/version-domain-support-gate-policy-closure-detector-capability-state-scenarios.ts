import { expect, it } from '@jest/globals';

import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { validateVersionDomainSupportManifestGate } from '../version/domain-support/version-domain-support-gate';
import { mutableDomainDetectorBridge } from './version-domain-support-gate-policy-closure-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

export function registerPolicyClosureDetectorCapabilityStateScenarios(): void {
  it('auto-detected mutable domains enforce their public policy capability states', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest({
            domains: [
              ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
              domainRow('tables'),
              domainRow('filters', { matrixRowId: 'filters.auto-filter' }),
              domainRow('named-ranges'),
              domainRow('external-links'),
              domainRow('data-validation'),
            ],
          }),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
          },
        },
        computeBridge: mutableDomainDetectorBridge(),
      } as any,
      'commit',
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'commit',
            diagnosticCode: 'capability-state-blocked',
            matrixRowId: 'external-links',
            domainId: 'external-links',
            capabilityKey: 'capture',
            capabilityState: 'opaque-preserved',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'commit',
            diagnosticCode: 'capability-state-blocked',
            matrixRowId: 'external-links',
            domainId: 'external-links',
            capabilityKey: 'persistence',
            capabilityState: 'opaque-preserved',
          }),
        }),
      ]),
    );
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.issueCode === 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID' &&
          diagnostic.payload.diagnosticCode === 'capability-state-blocked',
      ),
    ).toHaveLength(2);
  });
}
