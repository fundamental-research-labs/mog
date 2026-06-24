import { jest } from '@jest/globals';

import {
  BASE,
  EXPECTED_TARGET_HEAD,
  OURS,
  TARGET_REF,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-materializer-support-test-utils';
import {
  freshVersionDomainSupportManifest,
  versionDomainSupportManifestRow,
  versionDomainSupportManifestRuntime,
} from './version-domain-support-test-utils';

describe('WorkbookVersion applyMerge materializer support detector rows', () => {
  it.each([
    {
      label: 'unsupported workbook metadata row',
      matrixRowId: 'workbook-metadata',
      domainId: 'workbook-metadata',
      expectedMatrixRowId: 'workbook-metadata',
      expectedDomain: 'workbook-metadata',
    },
    {
      label: 'unsupported view-state row',
      matrixRowId: 'view-state.selection-scroll',
      domainId: 'view-state',
      expectedMatrixRowId: 'view-state.selection-scroll',
      expectedDomain: 'view-state',
      manifestRow: versionDomainSupportManifestRow('view-state', {
        matrixRowId: 'view-state.selection-scroll',
      }),
    },
  ])(
    'blocks fast-forward apply before preview or ref movement when detector rows expose $label',
    async ({ matrixRowId, domainId, expectedMatrixRowId, expectedDomain, manifestRow }) => {
      const merge = jest.fn();
      const fastForwardMerge = jest.fn();
      const mergeCommit = jest.fn();
      const version = workbookVersionWithVersioning(
        {
          mergeService: { merge },
          writeService: { fastForwardMerge, mergeCommit },
        },
        versionDomainSupportManifestRuntime({
          manifest: {
            domains: [
              ...freshVersionDomainSupportManifest().domains,
              ...(manifestRow ? [manifestRow] : []),
            ],
          },
          options: {
            detectorRows: [
              {
                matrixRowId,
                domainId,
                present: true,
                detectorId: `detector.${domainId}`,
              },
            ],
          },
        }),
      );

      await expect(
        version.applyMerge(
          { base: BASE, ours: OURS, theirs: THEIRS },
          { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.applyMerge',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
              data: expect.objectContaining({
                operation: 'applyMerge',
                mutationGuarantee: 'no-write-attempted',
                payload: expect.objectContaining({
                  structuralKind: 'metadata',
                  domain: expectedDomain,
                  matrixRowId: expectedMatrixRowId,
                  reason: 'unsupportedDetectedDomain',
                }),
              }),
            }),
          ],
        },
      });
      expect(merge).not.toHaveBeenCalled();
      expect(fastForwardMerge).not.toHaveBeenCalled();
      expect(mergeCommit).not.toHaveBeenCalled();
    },
  );
});
