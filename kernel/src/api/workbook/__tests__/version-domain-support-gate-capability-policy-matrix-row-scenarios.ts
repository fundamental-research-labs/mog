import { expect, it, jest } from '@jest/globals';

import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { WorkbookVersionImpl } from '../version';
import { BASE } from './version-domain-support-gate-test-helpers';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

export function registerDomainSupportCapabilityPolicyMatrixRowScenarios(): void {
  it('blocks checkout before invoking materialization services when a required matrix row is missing', async () => {
    const checkout = jest.fn();
    const planCheckout = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        checkoutService: { checkout, planCheckout },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.filter((id) => id !== 'cells.formulas').map(
            (id) => domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW },
      },
    } as any);

    await expect(version.checkout({ kind: 'commit', id: BASE })).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.checkout',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'checkout',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                diagnosticCode: 'required-matrix-row-missing',
                matrixRowId: 'cells.formulas',
              }),
            }),
          }),
        ]),
      },
    });
    expect(checkout).not.toHaveBeenCalled();
    expect(planCheckout).not.toHaveBeenCalled();
  });

  it('blocks commit when a broad domain row masks a required subtype matrix row', async () => {
    const commit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: freshManifest({
          domains: [
            ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
            domainRow('cells.formats', { matrixRowId: 'cells.formats' }),
          ],
        }),
        domainSupportManifestOptions: {
          now: NOW,
          requiredMatrixRowIds: ['cells.formats.direct'],
        },
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.commit',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'commit',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                diagnosticCode: 'required-matrix-row-missing',
                matrixRowId: 'cells.formats.direct',
              }),
            }),
          }),
        ]),
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });
}
