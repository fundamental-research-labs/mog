/**
 * Tests for table sub-range helper functions.
 *
 * These test the pure computation helpers that derive header, data body,
 * and totals row ranges from a TableInfo object.
 */

import type { TableInfo } from '@mog-sdk/contracts/api';
import {
  getDataBodyRangeFromInfo,
  getHeaderRowRangeFromInfo,
  getTotalRowRangeFromInfo,
} from '../../../src/api/worksheet/operations/table-operations';

/** Helper to build a minimal TableInfo for testing. */
function makeTable(overrides: Partial<TableInfo> & { range: string }): TableInfo {
  return {
    id: 'table-1',
    name: 'TestTable',
    displayName: 'TestTable',
    sheetId: 'sheet-1',
    columns: [],
    hasHeaderRow: true,
    hasTotalsRow: false,
    style: 'TableStyleMedium2',
    bandedRows: true,
    bandedColumns: false,
    emphasizeFirstColumn: false,
    emphasizeLastColumn: false,
    showFilterButtons: true,
    autoExpand: true,
    autoCalculatedColumns: true,
    ...overrides,
  };
}

describe('Table sub-range helpers', () => {
  describe('table with headers + totals (A1:D10, 10 rows)', () => {
    const table = makeTable({
      range: 'A1:D10',
      hasHeaderRow: true,
      hasTotalsRow: true,
    });

    it('getHeaderRowRangeFromInfo returns the first row', () => {
      expect(getHeaderRowRangeFromInfo(table)).toBe('A1:D1');
    });

    it('getDataBodyRangeFromInfo returns rows between header and totals', () => {
      // Header is row 1, totals is row 10, data body is rows 2-9
      expect(getDataBodyRangeFromInfo(table)).toBe('A2:D9');
    });

    it('getTotalRowRangeFromInfo returns the last row', () => {
      expect(getTotalRowRangeFromInfo(table)).toBe('A10:D10');
    });
  });

  describe('table without headers (B3:E8)', () => {
    const table = makeTable({
      range: 'B3:E8',
      hasHeaderRow: false,
      hasTotalsRow: true,
    });

    it('getHeaderRowRangeFromInfo returns null', () => {
      expect(getHeaderRowRangeFromInfo(table)).toBeNull();
    });

    it('getDataBodyRangeFromInfo starts at first row', () => {
      // No header, totals at row 8, so data body is rows 3-7
      expect(getDataBodyRangeFromInfo(table)).toBe('B3:E7');
    });

    it('getTotalRowRangeFromInfo returns the last row', () => {
      expect(getTotalRowRangeFromInfo(table)).toBe('B8:E8');
    });
  });

  describe('table without totals (C2:F6)', () => {
    const table = makeTable({
      range: 'C2:F6',
      hasHeaderRow: true,
      hasTotalsRow: false,
    });

    it('getHeaderRowRangeFromInfo returns the first row', () => {
      expect(getHeaderRowRangeFromInfo(table)).toBe('C2:F2');
    });

    it('getDataBodyRangeFromInfo extends to last row', () => {
      // Header at row 2, no totals, data body is rows 3-6
      expect(getDataBodyRangeFromInfo(table)).toBe('C3:F6');
    });

    it('getTotalRowRangeFromInfo returns null', () => {
      expect(getTotalRowRangeFromInfo(table)).toBeNull();
    });
  });

  describe('minimal table — single data row (A1:B3, headers + totals)', () => {
    const table = makeTable({
      range: 'A1:B3',
      hasHeaderRow: true,
      hasTotalsRow: true,
    });

    it('getHeaderRowRangeFromInfo returns row 1', () => {
      expect(getHeaderRowRangeFromInfo(table)).toBe('A1:B1');
    });

    it('getDataBodyRangeFromInfo returns the single data row', () => {
      expect(getDataBodyRangeFromInfo(table)).toBe('A2:B2');
    });

    it('getTotalRowRangeFromInfo returns row 3', () => {
      expect(getTotalRowRangeFromInfo(table)).toBe('A3:B3');
    });
  });

  describe('table with headers + totals but no data body (A1:C2)', () => {
    const table = makeTable({
      range: 'A1:C2',
      hasHeaderRow: true,
      hasTotalsRow: true,
    });

    it('getHeaderRowRangeFromInfo returns row 1', () => {
      expect(getHeaderRowRangeFromInfo(table)).toBe('A1:C1');
    });

    it('getDataBodyRangeFromInfo returns null (no room for data)', () => {
      expect(getDataBodyRangeFromInfo(table)).toBeNull();
    });

    it('getTotalRowRangeFromInfo returns row 2', () => {
      expect(getTotalRowRangeFromInfo(table)).toBe('A2:C2');
    });
  });

  describe('table with neither headers nor totals (D5:G10)', () => {
    const table = makeTable({
      range: 'D5:G10',
      hasHeaderRow: false,
      hasTotalsRow: false,
    });

    it('getHeaderRowRangeFromInfo returns null', () => {
      expect(getHeaderRowRangeFromInfo(table)).toBeNull();
    });

    it('getDataBodyRangeFromInfo returns entire range', () => {
      expect(getDataBodyRangeFromInfo(table)).toBe('D5:G10');
    });

    it('getTotalRowRangeFromInfo returns null', () => {
      expect(getTotalRowRangeFromInfo(table)).toBeNull();
    });
  });
});
