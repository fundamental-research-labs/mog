import { jest } from '@jest/globals';

export const POLICY_CLOSURE_DETECTOR_SHEET_ID = 'sheet-detector-1';

export function mutableDomainDetectorBridge() {
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
        sheetId: POLICY_CLOSURE_DETECTOR_SHEET_ID,
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
    getAllSheetIds: jest.fn(async () => [POLICY_CLOSURE_DETECTOR_SHEET_ID]),
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
