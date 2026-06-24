import { expect, it, jest } from '@jest/globals';

import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { validateVersionDomainSupportManifestGate } from '../version/domain-support/version-domain-support-gate';
import { mutableDomainDetectorBridge } from './version-domain-support-gate-policy-closure-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

export function registerPolicyClosureManifestSourceScenarios(): void {
  it('fails closed per required capability when a manifest source is missing', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          writeService: { commit: jest.fn() },
        },
      } as any,
      'commit',
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
          payload: expect.objectContaining({
            operation: 'commit',
            capabilityKey: 'capture',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
          payload: expect.objectContaining({
            operation: 'commit',
            capabilityKey: 'persistence',
          }),
        }),
      ]),
    );
  });
}

export function registerPolicyClosureOperationOverrideScenarios(): void {
  it('does not let caller options downgrade merge or applyMerge required row floors', async () => {
    for (const operation of ['merge', 'applyMerge'] as const) {
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
              requiredMatrixRowIds: [],
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
            payload: expect.objectContaining({
              operation,
              diagnosticCode: 'required-matrix-row-missing',
              matrixRowId: 'cells.formulas',
            }),
          }),
        ]),
      );
    }
  });

  it('does not let caller options downgrade merge or applyMerge required capabilities', async () => {
    for (const operation of ['merge', 'applyMerge'] as const) {
      const diagnostics = await validateVersionDomainSupportManifestGate(
        {
          versioning: {
            domainSupportManifest: freshManifest({
              domains: [
                ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
                domainRow('named-ranges'),
              ],
            }),
            domainSupportManifestOptions: {
              now: NOW,
              maxAgeMs: TEN_MINUTES_MS,
              requiredCapabilityKeys: [],
            },
          },
          computeBridge: mutableDomainDetectorBridge(),
        } as any,
        operation,
      );

      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            mutationGuarantee: 'no-write-attempted',
            payload: expect.objectContaining({
              operation,
              diagnosticCode: 'capability-state-blocked',
              matrixRowId: 'named-ranges',
              domainId: 'named-ranges',
              capabilityKey: 'merge',
              capabilityState: 'contracted',
            }),
          }),
        ]),
      );
    }
  });

  it('promotes present detector rows into export required row diagnostics', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest(),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
            requiredMatrixRowIds: [],
            detectorRows: [
              {
                matrixRowId: 'named-ranges',
                domainId: 'named-ranges',
                present: true,
                detectorId: 'detector.named-ranges',
              },
            ],
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
            matrixRowId: 'named-ranges',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'export',
            diagnosticCode: 'detector-row-missing',
            matrixRowId: 'named-ranges',
            domainId: 'named-ranges',
          }),
        }),
      ]),
    );
  });
}
