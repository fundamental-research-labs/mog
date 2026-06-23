import { expect, it, jest } from '@jest/globals';

import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { WorkbookVersionImpl } from '../version';
import { BASE, OURS, THEIRS, mergeInput } from './version-domain-support-gate-merge-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainCapabilityStates as capabilityStates,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

export function registerMergeGatePreviewScenarios(): void {
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

  it('routes merge preview after public merge capability validation passes', async () => {
    const mergeResult = {
      status: 'clean' as const,
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only' as const,
    };
    const merge = jest.fn(async () => mergeResult);
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        domainSupportManifest: freshManifest(),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    await expect(version.merge(mergeInput())).resolves.toEqual({
      ok: true,
      value: mergeResult,
    });
    expect(merge).toHaveBeenCalledWith(mergeInput(), {});
  });

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

  it('blocks merge preview when detector rows expose an unsupported merge domain after public merge capability validation passes', async () => {
    const merge = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
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

    await expect(version.merge(mergeInput())).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.merge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
            data: expect.objectContaining({
              operation: 'merge',
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
  });

  it('routes merge preview when detector rows stay inside the materializer domain surface', async () => {
    const mergeResult = {
      status: 'clean' as const,
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only' as const,
    };
    const merge = jest.fn(async () => mergeResult);
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        domainSupportManifest: freshManifest(),
        domainSupportManifestOptions: {
          now: NOW,
          detectorRows: [
            {
              matrixRowId: 'cells.values',
              domainId: 'cells.values',
              present: true,
              detectorId: 'detector.cells-values',
            },
          ],
        },
      },
    } as any);

    await expect(version.merge(mergeInput())).resolves.toEqual({
      ok: true,
      value: mergeResult,
    });
    expect(merge).toHaveBeenCalledWith(mergeInput(), {});
  });
}
