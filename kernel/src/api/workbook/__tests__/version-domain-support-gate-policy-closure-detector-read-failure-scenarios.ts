import { expect, it, jest } from '@jest/globals';

import { validateVersionDomainSupportManifestGate } from '../version/domain-support/version-domain-support-gate';
import { POLICY_CLOSURE_DETECTOR_SHEET_ID } from './version-domain-support-gate-policy-closure-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';

export function registerPolicyClosureDetectorReadFailureScenarios(): void {
  it('fails closed with redacted diagnostics when mutable domain detection cannot read workbook state', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest(),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
          },
        },
        computeBridge: {
          getAllSheetIds: jest.fn(async () => [POLICY_CLOSURE_DETECTOR_SHEET_ID]),
          getAllTablesInSheet: jest.fn(async () => []),
          getFiltersInSheet: jest.fn(async () => []),
          getAllNamedRangesWire: jest.fn(async () => {
            throw new Error('SecretRevenueRange read failed for https://secret.example.invalid');
          }),
          getHyperlinks: jest.fn(async () => []),
          getRangeSchemasForSheet: jest.fn(async () => []),
        },
      } as any,
      'commit',
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        issueCode: 'VERSION_DOMAIN_SUPPORT_DETECTOR_READ_FAILED',
        recoverability: 'retry',
        mutationGuarantee: 'no-write-attempted',
        redacted: true,
        payload: expect.objectContaining({
          operation: 'commit',
          detectorId: 'detector.named-ranges',
          matrixRowId: 'named-ranges',
          domainId: 'named-ranges',
        }),
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('SecretRevenueRange');
    expect(JSON.stringify(diagnostics)).not.toContain('https://secret.example.invalid');
  });
}
