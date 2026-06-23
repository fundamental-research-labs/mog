import { expect, it, jest } from '@jest/globals';

import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { WorkbookVersionImpl } from '../version';
import { mergeInput } from './version-domain-support-gate-merge-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainCapabilityStates as capabilityStates,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

export function registerMergeGatePreviewRegistryScenarios(): void {
  it('blocks merge preview when the manifest downgrades merge state below the registry', async () => {
    const merge = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.formulas'
              ? domainRow(id, {
                  capabilityStates: {
                    ...capabilityStates(),
                    merge: 'contracted',
                  },
                })
              : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW },
      },
    } as any);

    await expect(version.merge(mergeInput())).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.merge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'merge',
              payload: expect.objectContaining({
                diagnosticCode: 'domain-policy-registry-mismatch',
                domainId: 'cells.formulas',
                policyField: 'capabilityStates.merge',
                policyValue: 'redacted',
              }),
            }),
          }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });
}
