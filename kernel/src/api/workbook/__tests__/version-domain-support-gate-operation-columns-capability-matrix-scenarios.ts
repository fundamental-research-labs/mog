import { expect, it } from '@jest/globals';

import { validateVersionDomainSupportManifestGate } from '../version/domain-support/version-domain-support-gate';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';
import { PUBLIC_GATE_CAPABILITY_CASES } from './version-domain-support-gate-operation-columns-test-utils';

export function registerOperationColumnCapabilityMatrixScenarios(): void {
  it('maps each operation to its exact manifest capability keys', async () => {
    for (const { operation, capabilityKeys } of PUBLIC_GATE_CAPABILITY_CASES) {
      const diagnostics = await validateVersionDomainSupportManifestGate(
        {
          versioning: {
            requireDomainSupportManifest: true,
          },
        } as any,
        operation,
      );

      expect(diagnostics).toHaveLength(capabilityKeys.length);
      expect(new Set(diagnostics.map((diagnostic) => diagnostic.payload.capabilityKey))).toEqual(
        new Set(capabilityKeys),
      );
      for (const diagnostic of diagnostics) {
        expect(diagnostic).toMatchObject({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
          mutationGuarantee: 'no-write-attempted',
          redacted: true,
          payload: expect.objectContaining({
            operation,
          }),
        });
      }
    }
  });

  it('fails closed when an operation has no explicit capability-matrix row', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          requireDomainSupportManifest: true,
          domainSupportManifest: freshManifest(),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
          },
        },
      } as any,
      'futureOperation' as any,
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        issueCode: 'VERSION_DOMAIN_SUPPORT_OPERATION_CAPABILITY_MATRIX_INVALID',
        mutationGuarantee: 'no-write-attempted',
        redacted: true,
        payload: expect.objectContaining({
          operation: 'futureOperation',
          diagnosticCode: 'operation-capability-mapping-missing-or-ambiguous',
        }),
      }),
    ]);
  });
}
