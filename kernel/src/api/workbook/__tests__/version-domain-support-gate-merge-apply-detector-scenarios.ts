import { expect, it, jest } from '@jest/globals';

import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { WorkbookVersionImpl } from '../version';
import {
  EXPECTED_TARGET_HEAD,
  TARGET_REF,
  mergeInput,
} from './version-domain-support-gate-merge-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

export function registerMergeGateApplyDetectorScenarios(): void {
  it('blocks applyMerge before previewing or invoking write services when detector rows expose an unsupported merge domain after public merge capability validation passes', async () => {
    const merge = jest.fn();
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        writeService: { fastForwardMerge, mergeCommit },
        domainSupportManifest: freshManifest({
          domains: [
            ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
            domainRow('view-state', { matrixRowId: 'view-state.selection-scroll' }),
          ],
        }),
        domainSupportManifestOptions: {
          now: NOW,
          requiredMatrixRowIds: [],
          detectorRows: [
            {
              matrixRowId: 'view-state.selection-scroll',
              domainId: 'view-state',
              present: true,
              detectorId: 'detector.view-state',
            },
          ],
        },
      },
    } as any);

    await expect(
      version.applyMerge(mergeInput(), {
        targetRef: TARGET_REF as any,
        expectedTargetHead: EXPECTED_TARGET_HEAD,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.applyMerge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
            data: expect.objectContaining({
              operation: 'applyMerge',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                domain: 'view-state',
                matrixRowId: 'view-state.selection-scroll',
                reason: 'unsupportedDetectedDomain',
              }),
            }),
          }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });
}
