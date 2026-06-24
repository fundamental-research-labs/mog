import { expect, it } from '@jest/globals';

import { PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY } from '@mog-sdk/contracts/versioning';
import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { validateVersionDomainSupportManifestGate } from '../version/domain-support/version-domain-support-gate';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  exportSupportedVersionDomainPolicyRegistry as exportSupportedPolicyRegistry,
  exportSupportedVersionDomainSupportManifest as exportSupportedManifest,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

export function registerPolicyClosureRegistryScenarios(): void {
  it('does not let caller registries promote merge support beyond public runtime policy', async () => {
    const domainSupportManifest = freshManifest({
      domains: [
        ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
        {
          ...domainRow('named-ranges'),
          capabilityStates: {
            ...domainRow('named-ranges').capabilityStates,
            merge: 'supported',
          },
        },
      ],
    });
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest,
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
            domainPolicyRegistry: exportSupportedPolicyRegistry(domainSupportManifest),
          },
        },
      } as any,
      'merge',
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'merge',
            diagnosticCode: 'domain-policy-registry-mismatch',
            policyField: 'capabilityStates.merge',
            policyValue: 'supported',
            matrixRowId: 'named-ranges',
          }),
        }),
      ]),
    );
  });

  it('does not let caller registries promote export support for any public registry row', async () => {
    const domainSupportManifest = exportSupportedManifest();
    const exportUnsupportedPublicRows = PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.filter(
      (row) => row.capabilityStates.export !== 'supported',
    );
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest,
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
            domainPolicyRegistry: exportSupportedPolicyRegistry(domainSupportManifest),
          },
        },
      } as any,
      'export',
    );

    const promotedMismatchRows = diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.issueCode === 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID' &&
          diagnostic.payload.diagnosticCode === 'domain-policy-registry-mismatch' &&
          diagnostic.payload.policyField === 'capabilityStates.export',
      )
      .map((diagnostic) => diagnostic.payload.matrixRowId);

    expect(promotedMismatchRows).toHaveLength(exportUnsupportedPublicRows.length);
    expect(new Set(promotedMismatchRows)).toEqual(
      new Set(exportUnsupportedPublicRows.map((row) => row.matrixRowId)),
    );
  });
}
