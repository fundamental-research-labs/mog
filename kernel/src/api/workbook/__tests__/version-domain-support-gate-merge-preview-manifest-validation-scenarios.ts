import { expect, it, jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import { mergeInput } from './version-domain-support-gate-merge-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';

export function registerMergeGatePreviewManifestValidationScenarios(): void {
  it('blocks merge preview before invoking the merge service when the manifest is invalid', async () => {
    const merge = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        domainSupportManifest: freshManifest({ schemaVersion: '999' }),
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
                diagnosticCode: 'schema-version-unsupported',
              }),
            }),
          }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });
}
