import { jest } from '@jest/globals';

import type { VersionMergeInput } from '@mog-sdk/contracts/api';
import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { WorkbookVersionImpl } from '../version';
import { validateVersionDomainSupportManifestGate } from '../version-domain-support-gate';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_CREATED_AT as CREATED_AT,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_ONE_MINUTE_MS as ONE_MINUTE_MS,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
  selfPromotedVersionDomainSupportManifest as selfPromotedManifest,
  versionDomainCapabilityStates as capabilityStates,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];
const TARGET_REF = 'refs/heads/main';
const EXPECTED_TARGET_HEAD = {
  commitId: OURS,
  revision: { kind: 'counter' as const, value: '1' },
};
const DETECTOR_SHEET_ID = 'sheet-detector-1';
const MUTABLE_DOMAIN_DETECTOR_CASES = [
  {
    label: 'tables',
    detectorId: 'detector.tables',
    matrixRowId: 'tables',
    domainId: 'tables',
    missingMethods: ['getAllTablesInSheet'],
    throwingMethod: 'getAllTablesInSheet',
  },
  {
    label: 'filters',
    detectorId: 'detector.filters.auto-filter',
    matrixRowId: 'filters.auto-filter',
    domainId: 'filters',
    missingMethods: ['getFiltersInSheet'],
    throwingMethod: 'getFiltersInSheet',
  },
  {
    label: 'named ranges',
    detectorId: 'detector.named-ranges',
    matrixRowId: 'named-ranges',
    domainId: 'named-ranges',
    missingMethods: ['namedRangeCount', 'getAllNamedRangesWire'],
    throwingMethod: 'namedRangeCount',
  },
  {
    label: 'links',
    detectorId: 'detector.external-links',
    matrixRowId: 'external-links',
    domainId: 'external-links',
    missingMethods: ['getHyperlinks'],
    throwingMethod: 'getHyperlinks',
  },
  {
    label: 'data validation',
    detectorId: 'detector.data-validation',
    matrixRowId: 'data-validation',
    domainId: 'data-validation',
    missingMethods: ['getRangeSchemasForSheet'],
    throwingMethod: 'getRangeSchemasForSheet',
  },
] as const;

type MutableDomainDetectorCase = (typeof MUTABLE_DOMAIN_DETECTOR_CASES)[number];

function mutableDomainDetectorNoopBridge(): Record<string, unknown> {
  return {
    getAllSheetIds: jest.fn(async () => [DETECTOR_SHEET_ID]),
    getAllTablesInSheet: jest.fn(async () => []),
    getFiltersInSheet: jest.fn(async () => []),
    namedRangeCount: jest.fn(async () => 0),
    getAllNamedRangesWire: jest.fn(async () => []),
    getHyperlinks: jest.fn(async () => []),
    getRangeSchemasForSheet: jest.fn(async () => []),
  };
}

function mutableDomainDetectorBridgeWithMissingMethods(
  detector: MutableDomainDetectorCase,
): Record<string, unknown> {
  const bridge = mutableDomainDetectorNoopBridge();
  for (const method of detector.missingMethods) {
    delete bridge[method];
  }
  return bridge;
}

function mutableDomainDetectorBridgeWithThrowingMethod(
  detector: MutableDomainDetectorCase,
  message: string,
): Record<string, unknown> {
  const bridge = mutableDomainDetectorNoopBridge();
  bridge[detector.throwingMethod] = jest.fn(async () => {
    throw new Error(message);
  });
  return bridge;
}

function versionWithMutableDomainDetectorBridge(
  computeBridge: Record<string, unknown>,
  commit: ReturnType<typeof jest.fn>,
): WorkbookVersionImpl {
  return new WorkbookVersionImpl({
    versioning: {
      writeService: { commit },
      domainSupportManifest: freshManifest(),
      domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
    },
    computeBridge,
  } as any);
}

function expectDetectorPublicDiagnostic(
  result: Awaited<ReturnType<WorkbookVersionImpl['commit']>>,
  code:
    | 'VERSION_DOMAIN_SUPPORT_DETECTOR_UNAVAILABLE'
    | 'VERSION_DOMAIN_SUPPORT_DETECTOR_READ_FAILED',
  detector: MutableDomainDetectorCase,
  recoverability: 'none' | 'retry',
): void {
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.commit',
    },
  });
  if (result.ok) {
    throw new Error('expected version.commit to fail');
  }

  expect(result.error.diagnostics).toHaveLength(1);
  const diagnostic = result.error.diagnostics.find((item) => item.code === code);
  expect(diagnostic).toMatchObject({
    code,
    severity: 'error',
    message: expect.any(String),
    data: expect.objectContaining({
      operation: 'commit',
      recoverability,
      messageTemplateId: `version.commit.${code}`,
      redacted: true,
      mutationGuarantee: 'no-write-attempted',
    }),
  });
  expect(diagnostic?.data?.payload).toEqual({
    operation: 'commit',
    detectorId: detector.detectorId,
    matrixRowId: detector.matrixRowId,
    domainId: detector.domainId,
  });
}

describe('WorkbookVersion domain support manifest gate', () => {
  it('fails closed before invoking version-capable services when no manifest source is attached', async () => {
    const commit = jest.fn();
    const checkout = jest.fn();
    const merge = jest.fn();
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit, fastForwardMerge, mergeCommit },
        checkoutService: { checkout },
        mergeService: { merge },
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.commit',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            data: expect.objectContaining({
              operation: 'commit',
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });
    await expect(version.checkout({ kind: 'commit', id: BASE })).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.checkout',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            data: expect.objectContaining({
              operation: 'checkout',
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });
    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.merge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            data: expect.objectContaining({
              operation: 'merge',
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });
    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.applyMerge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            data: expect.objectContaining({
              operation: 'applyMerge',
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });

    expect(commit).not.toHaveBeenCalled();
    expect(checkout).not.toHaveBeenCalled();
    expect(merge).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('fails closed for persisted applyMerge writer aliases when no manifest source is attached', async () => {
    const fastForward = jest.fn();
    const applyFastForwardMerge = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        versionWriteService: { fastForward },
        applyFastForwardMerge,
      },
    } as any);

    await expect(
      version.applyMerge(
        {
          resultId: 'merge-result:review-main',
          resultDigest: { algorithm: 'sha256', digest: 'a'.repeat(64) },
        } as any,
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.applyMerge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            data: expect.objectContaining({
              operation: 'applyMerge',
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });
    expect(fastForward).not.toHaveBeenCalled();
    expect(applyFastForwardMerge).not.toHaveBeenCalled();
  });

  it('blocks commit before invoking the write service when the manifest is stale', async () => {
    const commit = jest.fn(async () => ({
      status: 'success',
      summary: {
        id: THEIRS,
        parents: [OURS],
        createdAt: CREATED_AT,
        author: { actorKind: 'user', displayName: 'User One' },
      },
      diagnostics: [],
    }));
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: freshManifest({ generatedAt: '2026-06-20T00:00:00.000Z' }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: ONE_MINUTE_MS },
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
                diagnosticCode: 'manifest-stale',
              }),
            }),
          }),
        ]),
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('blocks commit when an attached manifest self-promotes beyond the public policy registry', async () => {
    const commit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: selfPromotedManifest(),
        domainSupportManifestOptions: {
          now: NOW,
          maxAgeMs: TEN_MINUTES_MS,
          domainPolicyRegistry: {
            schemaVersion: 'version-domain-policy-registry.v1',
            generatedAt: CREATED_AT,
            domains: selfPromotedManifest().domains,
          },
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
                diagnosticCode: 'domain-policy-registry-mismatch',
                domainId: 'recalc-caches',
                policyField: 'domainClass',
                policyValue: 'authored',
              }),
            }),
          }),
        ]),
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

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

  it('blocks commit before invoking the write service when a required capability is not supported', async () => {
    const commit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.values'
              ? domainRow(id, {
                  capabilityStates: {
                    ...capabilityStates(),
                    capture: 'contracted',
                  },
                })
              : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
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
                diagnosticCode: 'capability-state-blocked',
                domainId: 'cells.values',
                capabilityKey: 'capture',
                capabilityState: 'contracted',
              }),
            }),
          }),
        ]),
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('blocks commit before invoking the write service when policy write admission is block', async () => {
    const commit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.values'
              ? domainRow(id, {
                  writeAdmissionMode: 'block',
                })
              : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
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
                diagnosticCode: 'write-admission-mode-blocked',
                domainId: 'cells.values',
                policyField: 'writeAdmissionMode',
                policyValue: 'block',
              }),
            }),
          }),
        ]),
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('blocks commit when a manifest only carries the legacy scalar capabilityState', async () => {
    const commit = jest.fn();
    const legacyRow = domainRow('cells.values') as any;
    delete legacyRow.capabilityStates;
    legacyRow.capabilityState = 'supported';
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.values' ? legacyRow : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
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
                diagnosticCode: 'capability-states-missing',
                domainId: 'cells.values',
              }),
            }),
          }),
        ]),
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

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

  it('blocks checkout based on checkout capability state', async () => {
    const checkout = jest.fn();
    const planCheckout = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        checkoutService: { checkout, planCheckout },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'sheets'
              ? domainRow(id, {
                  capabilityStates: {
                    ...capabilityStates(),
                    checkout: 'not-started',
                  },
                })
              : domainRow(id),
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
                diagnosticCode: 'capability-state-blocked',
                domainId: 'sheets',
                capabilityKey: 'checkout',
                capabilityState: 'not-started',
              }),
            }),
          }),
        ]),
      },
    });
    expect(checkout).not.toHaveBeenCalled();
    expect(planCheckout).not.toHaveBeenCalled();
  });

  it('fails closed before invoking the write service when mutable domain detector methods are missing', async () => {
    for (const detector of MUTABLE_DOMAIN_DETECTOR_CASES) {
      const commit = jest.fn();
      const version = versionWithMutableDomainDetectorBridge(
        mutableDomainDetectorBridgeWithMissingMethods(detector),
        commit,
      );

      const result = await version.commit();

      expectDetectorPublicDiagnostic(
        result,
        'VERSION_DOMAIN_SUPPORT_DETECTOR_UNAVAILABLE',
        detector,
        'none',
      );
      expect(commit).not.toHaveBeenCalled();
    }
  });

  it('fails closed with redacted public diagnostics when mutable domain detector methods throw', async () => {
    for (const detector of MUTABLE_DOMAIN_DETECTOR_CASES) {
      const commit = jest.fn();
      const version = versionWithMutableDomainDetectorBridge(
        mutableDomainDetectorBridgeWithThrowingMethod(
          detector,
          `Detector read leaked ConfidentialDealRoom42 from https://private.example.invalid/customer-42 while checking ${detector.label}.`,
        ),
        commit,
      );

      const result = await version.commit();

      expectDetectorPublicDiagnostic(
        result,
        'VERSION_DOMAIN_SUPPORT_DETECTOR_READ_FAILED',
        detector,
        'retry',
      );
      expect(JSON.stringify(result)).not.toContain('ConfidentialDealRoom42');
      expect(JSON.stringify(result)).not.toContain('https://private.example.invalid/customer-42');
      expect(commit).not.toHaveBeenCalled();
    }
  });

  it('fails closed when an advertised required manifest source is missing', async () => {
    const readDomainSupportManifest = jest.fn(async () => null);
    const commit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        readDomainSupportManifest,
        requireDomainSupportManifest: true,
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.commit',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            data: expect.objectContaining({
              operation: 'commit',
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });
    expect(readDomainSupportManifest).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });
});
