import { expect, it } from '@jest/globals';

import { validateVersionDomainSupportManifestGate } from '../version/domain-support/version-domain-support-gate';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';

const DETECTOR_UNAVAILABLE_ROWS = [
  ['detector.tables', 'tables', 'tables'],
  ['detector.filters.auto-filter', 'filters.auto-filter', 'filters'],
  ['detector.named-ranges', 'named-ranges', 'named-ranges'],
  ['detector.external-links', 'external-links', 'external-links'],
  ['detector.data-validation', 'data-validation', 'data-validation'],
] as const;

export function registerPolicyClosureDetectorUnavailableScenarios(): void {
  it('fails closed with public-safe diagnostics when detector bridge methods are absent', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest(),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
          },
        },
        computeBridge: {},
      } as any,
      'commit',
    );

    for (const [detectorId, matrixRowId, domainId] of DETECTOR_UNAVAILABLE_ROWS) {
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_DETECTOR_UNAVAILABLE',
            recoverability: 'none',
            mutationGuarantee: 'no-write-attempted',
            redacted: true,
            payload: expect.objectContaining({
              operation: 'commit',
              detectorId,
              matrixRowId,
              domainId,
            }),
          }),
        ]),
      );
    }
  });
}
