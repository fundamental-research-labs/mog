import { jest } from '@jest/globals';

import { PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY } from '@mog-sdk/contracts/versioning';
import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { WorkbookVersionImpl } from '../version';
import { validateVersionDomainSupportManifestGate } from '../version-domain-support-gate';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  exportSupportedVersionDomainPolicyRegistry as exportSupportedPolicyRegistry,
  exportSupportedVersionDomainSupportManifest as exportSupportedManifest,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainCapabilityStates as capabilityStates,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

const DETECTOR_SHEET_ID = 'sheet-detector-1';

function mutableDomainDetectorBridge() {
  return {
    getAllTablesInSheet: jest.fn(async () => [
      {
        id: 'table-secret-1',
        name: 'SecretRevenueTable',
        range: { startRow: 0, startCol: 0, endRow: 9, endCol: 2 },
      },
    ]),
    getFiltersInSheet: jest.fn(async () => [
      {
        id: 'filter-secret-1',
        sheetId: DETECTOR_SHEET_ID,
        range: { startRow: 0, startCol: 0, endRow: 9, endCol: 2 },
      },
    ]),
    getAllNamedRangesWire: jest.fn(async () => [
      {
        id: 'name-secret-1',
        name: 'SecretRevenueRange',
        refersTo: { template: '=Sheet1!$A$1:$A$10', refs: [] },
      },
    ]),
    getAllSheetIds: jest.fn(async () => [DETECTOR_SHEET_ID]),
    getHyperlinks: jest.fn(async () => [
      {
        cellRef: 'B2',
        target: 'https://secret.example.invalid/deal-room',
        tooltip: 'private target',
      },
    ]),
    getRangeSchemasForSheet: jest.fn(async () => [
      {
        id: 'validation-secret-1',
        ranges: [{ startId: '0:0', endId: '0:0' }],
        schema: { constraints: { list: ['Confidential'] } },
      },
    ]),
  };
}

describe('WorkbookVersion domain support policy gate closure', () => {
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

  it('auto-detects public mutable domains as required manifest rows', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest(),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
          },
        },
        computeBridge: mutableDomainDetectorBridge(),
      } as any,
      'commit',
    );

    for (const row of [
      ['tables', 'tables'],
      ['filters.auto-filter', 'filters'],
      ['named-ranges', 'named-ranges'],
      ['external-links', 'external-links'],
      ['data-validation', 'data-validation'],
    ] as const) {
      const [matrixRowId, domainId] = row;
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            mutationGuarantee: 'no-write-attempted',
            payload: expect.objectContaining({
              operation: 'commit',
              diagnosticCode: 'required-matrix-row-missing',
              matrixRowId,
            }),
          }),
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            mutationGuarantee: 'no-write-attempted',
            payload: expect.objectContaining({
              operation: 'commit',
              diagnosticCode: 'detector-row-missing',
              matrixRowId,
              domainId,
            }),
          }),
        ]),
      );
    }
    expect(JSON.stringify(diagnostics)).not.toContain('SecretRevenueTable');
    expect(JSON.stringify(diagnostics)).not.toContain('filter-secret-1');
    expect(JSON.stringify(diagnostics)).not.toContain('SecretRevenueRange');
    expect(JSON.stringify(diagnostics)).not.toContain('https://secret.example.invalid');
    expect(JSON.stringify(diagnostics)).not.toContain('validation-secret-1');
  });

  it('auto-detected mutable domains enforce their public policy capability states', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest({
            domains: [
              ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
              domainRow('tables'),
              domainRow('filters', { matrixRowId: 'filters.auto-filter' }),
              domainRow('named-ranges'),
              domainRow('external-links'),
              domainRow('data-validation'),
            ],
          }),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
          },
        },
        computeBridge: mutableDomainDetectorBridge(),
      } as any,
      'commit',
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'commit',
            diagnosticCode: 'capability-state-blocked',
            matrixRowId: 'named-ranges',
            domainId: 'named-ranges',
            capabilityKey: 'capture',
            capabilityState: 'contracted',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'commit',
            diagnosticCode: 'capability-state-blocked',
            matrixRowId: 'tables',
            domainId: 'tables',
            capabilityKey: 'capture',
            capabilityState: 'contracted',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'commit',
            diagnosticCode: 'capability-state-blocked',
            matrixRowId: 'filters.auto-filter',
            domainId: 'filters',
            capabilityKey: 'capture',
            capabilityState: 'contracted',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'commit',
            diagnosticCode: 'capability-state-blocked',
            matrixRowId: 'external-links',
            domainId: 'external-links',
            capabilityKey: 'capture',
            capabilityState: 'opaque-preserved',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'commit',
            diagnosticCode: 'capability-state-blocked',
            matrixRowId: 'data-validation',
            domainId: 'data-validation',
            capabilityKey: 'capture',
            capabilityState: 'contracted',
          }),
        }),
      ]),
    );
  });

  it('fails closed with public-safe diagnostics when detector bridge methods are absent', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest(),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
          },
        },
        computeBridge: {},
      } as any,
      'commit',
    );

    for (const row of [
      ['detector.tables', 'tables', 'tables'],
      ['detector.filters.auto-filter', 'filters.auto-filter', 'filters'],
      ['detector.named-ranges', 'named-ranges', 'named-ranges'],
      ['detector.external-links', 'external-links', 'external-links'],
      ['detector.data-validation', 'data-validation', 'data-validation'],
    ] as const) {
      const [detectorId, matrixRowId, domainId] = row;
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_DETECTOR_UNAVAILABLE',
            recoverability: 'none',
            mutationGuarantee: 'no-write-attempted',
            redacted: true,
            payload: expect.objectContaining({
              operation: 'commit',
              detectorId,
              matrixRowId,
              domainId,
            }),
          }),
        ]),
      );
    }
  });

  it('fails closed with redacted diagnostics when mutable domain detection cannot read workbook state', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest(),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
          },
        },
        computeBridge: {
          getAllSheetIds: jest.fn(async () => [DETECTOR_SHEET_ID]),
          getAllTablesInSheet: jest.fn(async () => []),
          getFiltersInSheet: jest.fn(async () => []),
          getAllNamedRangesWire: jest.fn(async () => {
            throw new Error('SecretRevenueRange read failed for https://secret.example.invalid');
          }),
          getHyperlinks: jest.fn(async () => []),
          getRangeSchemasForSheet: jest.fn(async () => []),
        },
      } as any,
      'commit',
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        issueCode: 'VERSION_DOMAIN_SUPPORT_DETECTOR_READ_FAILED',
        recoverability: 'retry',
        mutationGuarantee: 'no-write-attempted',
        redacted: true,
        payload: expect.objectContaining({
          operation: 'commit',
          detectorId: 'detector.named-ranges',
          matrixRowId: 'named-ranges',
          domainId: 'named-ranges',
        }),
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('SecretRevenueRange');
    expect(JSON.stringify(diagnostics)).not.toContain('https://secret.example.invalid');
  });

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

  it('does not let caller registries promote merge support beyond public runtime policy', async () => {
    const domainSupportManifest = freshManifest({
      domains: [
        ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
        {
          ...domainRow('named-ranges'),
          capabilityStates: {
            ...domainRow('named-ranges').capabilityStates,
            merge: 'supported',
          },
        },
      ],
    });
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest,
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
            domainPolicyRegistry: exportSupportedPolicyRegistry(domainSupportManifest),
          },
        },
      } as any,
      'merge',
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'merge',
            diagnosticCode: 'domain-policy-registry-mismatch',
            policyField: 'capabilityStates.merge',
            policyValue: 'supported',
            matrixRowId: 'named-ranges',
          }),
        }),
      ]),
    );
  });

  it('does not let caller registries promote export support for any public registry row', async () => {
    const domainSupportManifest = exportSupportedManifest();
    const exportUnsupportedPublicRows = PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.filter(
      (row) => row.capabilityStates.export !== 'supported',
    );
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest,
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
            domainPolicyRegistry: exportSupportedPolicyRegistry(domainSupportManifest),
          },
        },
      } as any,
      'export',
    );

    const promotedMismatchRows = diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.issueCode === 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID' &&
          diagnostic.payload.diagnosticCode === 'domain-policy-registry-mismatch' &&
          diagnostic.payload.policyField === 'capabilityStates.export',
      )
      .map((diagnostic) => diagnostic.payload.matrixRowId);

    expect(promotedMismatchRows).toHaveLength(exportUnsupportedPublicRows.length);
    expect(new Set(promotedMismatchRows)).toEqual(
      new Set(exportUnsupportedPublicRows.map((row) => row.matrixRowId)),
    );
  });

  it('does not expose eval-only expected-failing capability states through public diagnostics', async () => {
    const commit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.values'
              ? (domainRow(id, {
                  capabilityStates: {
                    ...capabilityStates(),
                    capture: 'expected-failing',
                  } as any,
                }) as any)
              : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    const result = await version.commit();

    expect(result).toMatchObject({
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
                diagnosticCode: 'unknown-capability-state',
                domainId: 'cells.values',
                capabilityKey: 'capture',
              }),
            }),
          }),
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain('expected-failing');
    expect(commit).not.toHaveBeenCalled();
  });
});
