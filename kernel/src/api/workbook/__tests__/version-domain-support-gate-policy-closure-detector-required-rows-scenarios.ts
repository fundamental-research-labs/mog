import { expect, it } from '@jest/globals';

import { validateVersionDomainSupportManifestGate } from '../version/domain-support/version-domain-support-gate';
import { mutableDomainDetectorBridge } from './version-domain-support-gate-policy-closure-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';

const DETECTED_MUTABLE_DOMAIN_ROWS = [
  ['tables', 'tables'],
  ['filters.auto-filter', 'filters'],
  ['named-ranges', 'named-ranges'],
  ['external-links', 'external-links'],
  ['data-validation', 'data-validation'],
] as const;

export function registerPolicyClosureDetectorRequiredRowsScenarios(): void {
  it('auto-detects public mutable domains as required manifest rows', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest(),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
          },
        },
        computeBridge: mutableDomainDetectorBridge(),
      } as any,
      'commit',
    );

    for (const [matrixRowId, domainId] of DETECTED_MUTABLE_DOMAIN_ROWS) {
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            mutationGuarantee: 'no-write-attempted',
            payload: expect.objectContaining({
              operation: 'commit',
              diagnosticCode: 'required-matrix-row-missing',
              matrixRowId,
            }),
          }),
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            mutationGuarantee: 'no-write-attempted',
            payload: expect.objectContaining({
              operation: 'commit',
              diagnosticCode: 'detector-row-missing',
              matrixRowId,
              domainId,
            }),
          }),
        ]),
      );
    }
    expect(JSON.stringify(diagnostics)).not.toContain('SecretRevenueTable');
    expect(JSON.stringify(diagnostics)).not.toContain('filter-secret-1');
    expect(JSON.stringify(diagnostics)).not.toContain('SecretRevenueRange');
    expect(JSON.stringify(diagnostics)).not.toContain('https://secret.example.invalid');
    expect(JSON.stringify(diagnostics)).not.toContain('validation-secret-1');
  });
}
