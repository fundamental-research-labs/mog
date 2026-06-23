import { jest } from '@jest/globals';

import {
  DETECTOR_SHEET_ID,
  type MutableDomainDetectorCase,
} from './version-domain-support-gate-test-helpers-detector-cases';

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
