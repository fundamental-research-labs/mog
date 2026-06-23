import { jest } from '@jest/globals';

import type { VersionMergeInput } from '@mog-sdk/contracts/api';
import { WorkbookVersionImpl } from '../version';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';

export const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
export const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
export const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];
export const TARGET_REF = 'refs/heads/main';
export const EXPECTED_TARGET_HEAD = {
  commitId: OURS,
  revision: { kind: 'counter' as const, value: '1' },
};
export const DETECTOR_SHEET_ID = 'sheet-detector-1';

export const MUTABLE_DOMAIN_DETECTOR_CASES = [
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

export const SHEET_SCOPED_MUTABLE_DOMAIN_DETECTOR_CASES = [
  {
    detector: MUTABLE_DOMAIN_DETECTOR_CASES[0],
    rowReadMethod: 'getAllTablesInSheet',
  },
  {
    detector: MUTABLE_DOMAIN_DETECTOR_CASES[1],
    rowReadMethod: 'getFiltersInSheet',
  },
  {
    detector: MUTABLE_DOMAIN_DETECTOR_CASES[3],
    rowReadMethod: 'getHyperlinks',
  },
  {
    detector: MUTABLE_DOMAIN_DETECTOR_CASES[4],
    rowReadMethod: 'getRangeSchemasForSheet',
  },
] as const;

export type MutableDomainDetectorCase = (typeof MUTABLE_DOMAIN_DETECTOR_CASES)[number];

export function mutableDomainDetectorNoopBridge(): Record<string, unknown> {
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

export function mutableDomainDetectorBridgeWithMissingMethods(
  detector: MutableDomainDetectorCase,
): Record<string, unknown> {
  const bridge = mutableDomainDetectorNoopBridge();
  for (const method of detector.missingMethods) {
    delete bridge[method];
  }
  return bridge;
}

export function mutableDomainDetectorBridgeWithThrowingMethod(
  detector: MutableDomainDetectorCase,
  message: string,
): Record<string, unknown> {
  const bridge = mutableDomainDetectorNoopBridge();
  bridge[detector.throwingMethod] = jest.fn(async () => {
    throw new Error(message);
  });
  return bridge;
}

export function mutableDomainDetectorBridgeWithPresentRows(
  detector: MutableDomainDetectorCase,
): Record<string, unknown> {
  const bridge = mutableDomainDetectorNoopBridge();
  switch (detector.matrixRowId) {
    case 'tables':
      bridge.getAllTablesInSheet = jest.fn(async () => [{ id: 'table-1' }]);
      break;
    case 'filters.auto-filter':
      bridge.getFiltersInSheet = jest.fn(async () => [{ id: 'filter-1' }]);
      break;
    case 'named-ranges':
      bridge.namedRangeCount = jest.fn(async () => 1);
      break;
    case 'external-links':
      bridge.getHyperlinks = jest.fn(async () => [
        { cellRef: 'A1', target: 'https://example.test' },
      ]);
      break;
    case 'data-validation':
      bridge.getRangeSchemasForSheet = jest.fn(async () => [{ id: 'validation-1' }]);
      break;
  }
  return bridge;
}

export function versionWithMutableDomainDetectorBridge(
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

export function expectDetectorPublicDiagnostic(
  result: Awaited<ReturnType<WorkbookVersionImpl['commit']>>,
  code:
    | 'VERSION_DOMAIN_SUPPORT_DETECTOR_UNAVAILABLE'
    | 'VERSION_DOMAIN_SUPPORT_DETECTOR_READ_FAILED',
  detector: MutableDomainDetectorCase,
  recoverability: 'none' | 'retry',
  expectedDiagnosticCount = 1,
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

  expect(result.error.diagnostics).toHaveLength(expectedDiagnosticCount);
  const diagnostic = result.error.diagnostics.find(
    (item) =>
      item.code === code &&
      item.data?.payload?.detectorId === detector.detectorId &&
      item.data.payload.matrixRowId === detector.matrixRowId &&
      item.data.payload.domainId === detector.domainId,
  );
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
