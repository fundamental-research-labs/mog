import { expect, it } from '@jest/globals';

import { validateVersionDomainSupportManifestGate } from '../version/domain-support/version-domain-support-gate';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';
import {
  PUBLIC_PARTIAL_SUPPORT_BLOCKED_OPERATIONS,
  PUBLIC_PARTIAL_SUPPORT_SUPPORTED_OPERATIONS,
  capabilityStateBlocks,
} from './version-domain-support-gate-operation-columns-test-utils';

export function registerOperationColumnPartialSupportScenarios(): void {
  it('allows public partially supported domains for operations whose capability columns are supported', async () => {
    for (const operation of PUBLIC_PARTIAL_SUPPORT_SUPPORTED_OPERATIONS) {
      await expect(
        validateVersionDomainSupportManifestGate(
          {
            versioning: {
              domainSupportManifest: freshManifest(),
              domainSupportManifestOptions: {
                now: NOW,
                maxAgeMs: TEN_MINUTES_MS,
              },
            },
          } as any,
          operation,
        ),
      ).resolves.toEqual([]);
    }
  });

  it('blocks public partially supported domains only for the requested unsupported operation', async () => {
    for (const { operation, capabilityKey } of PUBLIC_PARTIAL_SUPPORT_BLOCKED_OPERATIONS) {
      const diagnostics = await validateVersionDomainSupportManifestGate(
        {
          versioning: {
            domainSupportManifest: freshManifest(),
            domainSupportManifestOptions: {
              now: NOW,
              maxAgeMs: TEN_MINUTES_MS,
            },
          },
        } as any,
        operation,
      );
      const capabilityBlocks = capabilityStateBlocks(diagnostics);

      expect(capabilityBlocks.length).toBeGreaterThan(0);
      expect(
        new Set(capabilityBlocks.map((diagnostic) => diagnostic.payload.capabilityKey)),
      ).toEqual(new Set([capabilityKey]));
      expect(capabilityBlocks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            mutationGuarantee: 'no-write-attempted',
            redacted: true,
            payload: expect.objectContaining({
              operation,
              diagnosticCode: 'capability-state-blocked',
              matrixRowId: 'workbook-metadata',
              capabilityKey,
              capabilityState: 'contracted',
            }),
          }),
        ]),
      );
    }
  });
}
