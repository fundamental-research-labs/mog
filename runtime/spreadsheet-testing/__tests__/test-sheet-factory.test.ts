/**
 * Test Sheet Factory Tests (no Yjs)
 *
 * Verifies that the schema-driven test utilities work correctly.
 */

import { createSheetMetaDefaults } from '@mog-sdk/kernel/testing';

import {
  addCellsToSheet,
  createTestCell,
  createTestSheet,
  createTestWorkbook,
  getCellAt,
  MapLike,
} from '../src/test-sheet-factory';

describe('createTestSheet', () => {
  it('should create a sheet with all required fields', () => {
    const sheet = createTestSheet();

    // Verify required SheetMaps fields exist
    expect(sheet.get('meta')).toBeInstanceOf(MapLike);
    expect(sheet.get('cells')).toBeInstanceOf(MapLike);
    expect(sheet.get('properties')).toBeInstanceOf(MapLike);
    expect(sheet.get('grid')).toBeInstanceOf(MapLike);
    expect(sheet.get('rowHeights')).toBeInstanceOf(MapLike);
    expect(sheet.get('colWidths')).toBeInstanceOf(MapLike);
    expect(sheet.get('charts')).toBeInstanceOf(MapLike);
    expect(sheet.get('schemas')).toBeInstanceOf(MapLike);

    // Row/Column identity model
    expect(sheet.get('rows')).toBeInstanceOf(MapLike);
    expect(sheet.get('cols')).toBeInstanceOf(MapLike);
    expect(sheet.get('rowIndex')).toBeInstanceOf(MapLike);
    expect(sheet.get('colIndex')).toBeInstanceOf(MapLike);
    expect(sheet.get('rowFormats')).toBeInstanceOf(MapLike);
    expect(sheet.get('colFormats')).toBeInstanceOf(MapLike);
  });

  it('should set meta id and name', () => {
    const sheet = createTestSheet({ sheetId: 'my-sheet', name: 'My Test Sheet' });

    const meta = sheet.get('meta') as MapLike<unknown>;
    expect(meta.get('id')).toBe('my-sheet');
    expect(meta.get('name')).toBe('My Test Sheet');
  });

  it('should apply meta defaults from schema', () => {
    const sheet = createTestSheet();

    const meta = sheet.get('meta') as MapLike<unknown>;
    const defaults = createSheetMetaDefaults();
    expect(meta.get('defaultRowHeight')).toBe(defaults.defaultRowHeight);
    expect(meta.get('defaultColWidth')).toBe(defaults.defaultColWidth);
    expect(meta.get('frozenRows')).toBe(defaults.frozenRows);
    expect(meta.get('frozenCols')).toBe(defaults.frozenCols);
    expect(meta.get('showGridlines')).toBe(defaults.showGridlines);
  });

  it('should apply meta overrides', () => {
    const sheet = createTestSheet({
      metaOverrides: { frozenRows: 2, frozenCols: 1 },
    });

    const meta = sheet.get('meta') as MapLike<unknown>;
    expect(meta.get('frozenRows')).toBe(2);
    expect(meta.get('frozenCols')).toBe(1);
  });

  it('should support legacy API with doc as first argument', () => {
    // Old API: createTestSheet(doc, options) -- doc is ignored
    const fakeDoc = { getMap: () => {} };
    const sheet = createTestSheet(fakeDoc, { name: 'Legacy Sheet' });

    const meta = sheet.get('meta') as MapLike<unknown>;
    expect(meta.get('name')).toBe('Legacy Sheet');
  });
});

describe('createTestWorkbook', () => {
  it('should create a workbook with default sheet', () => {
    const { sheets, sheetsMap } = createTestWorkbook();

    expect(sheets).toHaveLength(1);
    expect(sheetsMap.size).toBe(1);
  });

  it('should create multiple sheets', () => {
    const { sheets } = createTestWorkbook({ sheetCount: 3 });

    expect(sheets).toHaveLength(3);
  });

  it('should create named sheets', () => {
    const { sheets, getSheet } = createTestWorkbook({
      sheetNames: ['Summary', 'Raw Data', 'Charts'],
    });

    expect(sheets).toHaveLength(3);

    const summarySheet = getSheet('Summary');
    expect(summarySheet).toBeDefined();

    const meta = summarySheet!.get('meta') as MapLike<unknown>;
    expect(meta.get('name')).toBe('Summary');
  });

  it('getSheet should be case-insensitive', () => {
    const { getSheet } = createTestWorkbook({
      sheetNames: ['Summary', 'Raw Data', 'Charts'],
    });

    // Exact match
    expect(getSheet('Summary')).toBeDefined();
    // Lowercase
    expect(getSheet('summary')).toBeDefined();
    // Uppercase
    expect(getSheet('SUMMARY')).toBeDefined();
    // Mixed case
    expect(getSheet('sUmMaRy')).toBeDefined();
    // Non-existent
    expect(getSheet('NoSuchSheet')).toBeUndefined();
  });

  it('should apply per-sheet options', () => {
    const { sheets } = createTestWorkbook({
      sheetCount: 2,
      sheetOptions: {
        0: { metaOverrides: { frozenRows: 1 } },
        1: { metaOverrides: { hidden: true } },
      },
    });

    const meta0 = sheets[0].get('meta') as MapLike<unknown>;
    const meta1 = sheets[1].get('meta') as MapLike<unknown>;

    expect(meta0.get('frozenRows')).toBe(1);
    expect(meta1.get('hidden')).toBe(true);
  });

  it('should provide getSheetById helper', () => {
    const { getSheetById } = createTestWorkbook({ sheetCount: 3 });

    const sheet = getSheetById('sheet-1');
    expect(sheet).toBeDefined();

    const meta = sheet!.get('meta') as MapLike<unknown>;
    expect(meta.get('id')).toBe('sheet-1');
  });
});

describe('createTestCell', () => {
  it('should create cell with default values', () => {
    const cell = createTestCell();

    expect(cell.id).toBeDefined();
    expect(cell.row).toBe(0);
    expect(cell.col).toBe(0);
  });

  it('should create cell with custom values', () => {
    const cell = createTestCell({
      id: 'custom-id',
      row: 5,
      col: 3,
      value: 'Hello',
    });

    expect(cell.id).toBe('custom-id');
    expect(cell.row).toBe(5);
    expect(cell.col).toBe(3);
    expect(cell.r).toBe('Hello');
  });

  it('should create formula cell', () => {
    const cell = createTestCell({
      row: 0,
      col: 0,
      formula: 'SUM(A1:A10)',
      value: 55,
    });

    expect(cell.f).toBe('SUM(A1:A10)');
    expect(cell.r).toBe(55);
  });
});

describe('addCellsToSheet', () => {
  it('should add grid of cells to sheet', () => {
    const { sheets } = createTestWorkbook();
    const sheet = sheets[0];

    const cellIds = addCellsToSheet(sheet, [
      ['Name', 'Age', 'City'],
      ['Alice', 30, 'NYC'],
      ['Bob', 25, 'LA'],
    ]);

    expect(cellIds).toHaveLength(9);

    const cells = sheet.get('cells') as MapLike<unknown>;
    expect(cells.size).toBe(9);
  });

  it('should skip undefined/null values', () => {
    const { sheets } = createTestWorkbook();
    const sheet = sheets[0];

    const cellIds = addCellsToSheet(sheet, [
      ['A', null, 'C'],
      [undefined, 'B', undefined],
    ]);

    expect(cellIds).toHaveLength(3);
  });

  it('should support custom start position', () => {
    const { sheets } = createTestWorkbook();
    const sheet = sheets[0];

    addCellsToSheet(sheet, [['Value']], { startRow: 5, startCol: 3 });

    const foundCell = getCellAt(sheet, 5, 3);
    expect(foundCell).toBeDefined();
    expect(foundCell?.r).toBe('Value');
  });
});

describe('getCellAt', () => {
  it('should find cell by position', () => {
    const { sheets } = createTestWorkbook();
    const sheet = sheets[0];

    addCellsToSheet(sheet, [
      ['A1', 'B1'],
      ['A2', 'B2'],
    ]);

    const cell = getCellAt(sheet, 1, 1);
    expect(cell).toBeDefined();
    expect(cell?.r).toBe('B2');
  });

  it('should return undefined for empty position', () => {
    const { sheets } = createTestWorkbook();
    const sheet = sheets[0];

    const cell = getCellAt(sheet, 99, 99);
    expect(cell).toBeUndefined();
  });
});
