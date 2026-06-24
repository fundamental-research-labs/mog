import { expect, it } from '@jest/globals';

import { validateVersionDomainSupportManifestGate } from '../version/domain-support/version-domain-support-gate';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';
import { PUBLIC_GATE_CAPABILITY_CASES } from './version-domain-support-gate-operation-columns-test-utils';

export function registerOperationColumnManifestRowScenarios(): void {
  it('fails closed for every mapped operation when a required matrix row is missing', async () => {
    const missingMatrixRowId = 'sheets';

    for (const { operation } of PUBLIC_GATE_CAPABILITY_CASES) {
      const manifest = freshManifest();
      const diagnostics = await validateVersionDomainSupportManifestGate(
        {
          versioning: {
            domainSupportManifest: {
              ...manifest,
              domains: manifest.domains.filter((row) => row.matrixRowId !== missingMatrixRowId),
            },
            domainSupportManifestOptions: {
              now: NOW,
              maxAgeMs: TEN_MINUTES_MS,
            },
          },
        } as any,
        operation,
      );

      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            mutationGuarantee: 'no-write-attempted',
            redacted: true,
            payload: expect.objectContaining({
              operation,
              diagnosticCode: 'required-matrix-row-missing',
              matrixRowId: missingMatrixRowId,
            }),
          }),
        ]),
      );
    }
  });

  it('fails closed for every mapped operation when a matrix row is ambiguous', async () => {
    for (const { operation } of PUBLIC_GATE_CAPABILITY_CASES) {
      const manifest = freshManifest();
      const duplicateRow = manifest.domains[0]!;
      const diagnostics = await validateVersionDomainSupportManifestGate(
        {
          versioning: {
            domainSupportManifest: {
              ...manifest,
              domains: [...manifest.domains, duplicateRow],
            },
            domainSupportManifestOptions: {
              now: NOW,
              maxAgeMs: TEN_MINUTES_MS,
            },
          },
        } as any,
        operation,
      );

      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            mutationGuarantee: 'no-write-attempted',
            redacted: true,
            payload: expect.objectContaining({
              operation,
              diagnosticCode: 'duplicate-matrix-row',
              matrixRowId: duplicateRow.matrixRowId,
            }),
          }),
        ]),
      );
    }
  });
}
