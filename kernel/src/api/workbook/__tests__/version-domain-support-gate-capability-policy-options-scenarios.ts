import { expect, it } from '@jest/globals';

import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { validateVersionDomainSupportManifestGate } from '../version/domain-support/version-domain-support-gate';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

export function registerDomainSupportCapabilityPolicyOptionsScenarios(): void {
  it('does not let caller options downgrade export-required capability checks', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest({
            domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => {
              const row = domainRow(id);
              return id === 'cells.values'
                ? {
                    ...row,
                    capabilityStates: {
                      ...row.capabilityStates,
                      export: 'contracted',
                    },
                  }
                : row;
            }),
          }),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
            requiredCapabilityKeys: [],
            requiredMatrixRowIds: [],
          },
        },
      } as any,
      'export',
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'export',
            diagnosticCode: 'capability-state-blocked',
            domainId: 'cells.values',
            capabilityKey: 'export',
            capabilityState: 'contracted',
          }),
        }),
      ]),
    );
    expect(diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            diagnosticCode: 'required-matrix-row-missing',
            matrixRowId: 'cells.formats.direct',
          }),
        }),
      ]),
    );
  });

  it('does not let caller options downgrade export-required row checks', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest({
            domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.filter((id) => id !== 'cells.formulas').map(
              (id) => domainRow(id),
            ),
          }),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
            requiredCapabilityKeys: [],
            requiredMatrixRowIds: [],
          },
        },
      } as any,
      'export',
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'export',
            diagnosticCode: 'required-matrix-row-missing',
            matrixRowId: 'cells.formulas',
          }),
        }),
      ]),
    );
  });
}
