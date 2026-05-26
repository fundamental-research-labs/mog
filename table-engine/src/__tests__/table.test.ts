/**
 * Table Engine — table.ts tests
 *
 * Comprehensive coverage for the pure, stateless table model.
 *
 * Since table.ts now delegates to WASM, we mock the WASM backend with
 * pure-JS implementations that replicate the original TS logic.
 */

import type { CellRange, Table, TableColumn, TotalsFunction } from '../types';

// ---------------------------------------------------------------------------
// WASM mock — faithful replica of original TS table.ts logic
// ---------------------------------------------------------------------------

const SUBTOTAL_FUNCTION_NUMBER: Partial<Record<string, number>> = {
  average: 101,
  count: 102,
  countNums: 103,
  max: 104,
  min: 105,
  stdDev: 107,
  sum: 109,
  var: 110,
};

function validateRange(range: CellRange): void {
  if (range.startRow > range.endRow) {
    throw new Error(
      `Invalid range: startRow (${range.startRow}) must be <= endRow (${range.endRow})`,
    );
  }
  if (range.startCol > range.endCol) {
    throw new Error(
      `Invalid range: startCol (${range.startCol}) must be <= endCol (${range.endCol})`,
    );
  }
}

function escapeColumnNameForRef(name: string): string {
  if (/['\[\]#@]/.test(name)) {
    const escaped = name.replace(/'/g, "''").replace(/\[/g, '[[').replace(/\]/g, ']]');
    return "'" + escaped + "'";
  }
  return name;
}

function mockGetDataRange(table: Table): CellRange {
  const { range, hasHeaderRow, hasTotalsRow } = table;
  return {
    startRow: hasHeaderRow ? range.startRow + 1 : range.startRow,
    startCol: range.startCol,
    endRow: hasTotalsRow ? range.endRow - 1 : range.endRow,
    endCol: range.endCol,
  };
}

const mockWasm = {
  table_create_table(
    name: string,
    sheetId: string,
    range: CellRange,
    headerValues: readonly string[],
    id: string,
    style: string | null,
  ): Table {
    validateRange(range);
    const colCount = range.endCol - range.startCol + 1;
    const columns: readonly TableColumn[] = Array.from({ length: colCount }, (_, i) => ({
      id: `${id}-col-${i}`,
      name: i < headerValues.length ? headerValues[i] : `Column${i + 1}`,
      index: i,
      totalsFunction: null,
      totalsLabel: null,
    }));
    return {
      id,
      name,
      sheetId,
      range: { ...range },
      columns,
      hasHeaderRow: true,
      hasTotalsRow: false,
      style: style ?? 'TableStyleMedium2',
      bandedRows: true,
      bandedColumns: false,
      emphasizeFirstColumn: false,
      emphasizeLastColumn: false,
      showFilterButtons: true,
    };
  },

  table_resize_table(table: Table, newRange: CellRange): Table {
    validateRange(newRange);
    const oldColCount = table.range.endCol - table.range.startCol + 1;
    const newColCount = newRange.endCol - newRange.startCol + 1;
    let columns: TableColumn[];
    if (newColCount > oldColCount) {
      let maxSuffix = -1;
      const prefix = `${table.id}-col-`;
      for (const col of table.columns) {
        if (col.id.startsWith(prefix)) {
          const num = parseInt(col.id.slice(prefix.length), 10);
          if (!isNaN(num) && num > maxSuffix) maxSuffix = num;
        }
      }
      let nextSuffix = Math.max(maxSuffix + 1, newColCount);
      columns = [...table.columns];
      for (let i = oldColCount; i < newColCount; i++) {
        columns.push({
          id: `${table.id}-col-${nextSuffix++}`,
          name: `Column${i + 1}`,
          index: i,
          totalsFunction: null,
          totalsLabel: null,
        });
      }
    } else if (newColCount < oldColCount) {
      columns = [...table.columns].slice(0, newColCount);
    } else {
      columns = [...table.columns];
    }
    const reindexed: readonly TableColumn[] = columns.map((col, idx) => ({ ...col, index: idx }));
    return { ...table, range: { ...newRange }, columns: reindexed };
  },

  table_add_column(table: Table, name: string, position: number): Table {
    const pos = Math.max(0, Math.min(position, table.columns.length));
    let finalName = name;
    const existingNames = new Set(table.columns.map((c) => c.name.toLowerCase()));
    while (existingNames.has(finalName.toLowerCase())) {
      finalName = finalName + '2';
    }
    const cols = [...table.columns];
    // Generate a unique ID for the new column
    let maxSuffix = -1;
    const prefix = `${table.id}-col-`;
    for (const col of table.columns) {
      if (col.id.startsWith(prefix)) {
        const num = parseInt(col.id.slice(prefix.length), 10);
        if (!isNaN(num) && num > maxSuffix) maxSuffix = num;
      }
    }
    const newCol: TableColumn = {
      id: `${table.id}-col-${maxSuffix + 1}`,
      name: finalName,
      index: pos,
      totalsFunction: null,
      totalsLabel: null,
    };
    cols.splice(pos, 0, newCol);
    const reindexed: readonly TableColumn[] = cols.map((col, idx) => ({ ...col, index: idx }));
    return {
      ...table,
      columns: reindexed,
      range: { ...table.range, endCol: table.range.endCol + 1 },
    };
  },

  table_remove_column(table: Table, columnId: string): Table {
    if (table.columns.length <= 1) return table;
    const idx = table.columns.findIndex((c) => c.id === columnId);
    if (idx === -1) return table;
    const cols = table.columns.filter((c) => c.id !== columnId);
    const reindexed: readonly TableColumn[] = cols.map((col, i) => ({ ...col, index: i }));
    return {
      ...table,
      columns: reindexed,
      range: { ...table.range, endCol: table.range.endCol - 1 },
    };
  },

  table_rename_column(table: Table, columnId: string, newName: string): Table {
    const target = table.columns.find((c) => c.id === columnId);
    if (!target) return table;
    const lowerNew = newName.toLowerCase();
    for (const col of table.columns) {
      if (col.id !== columnId && col.name.toLowerCase() === lowerNew) {
        throw new Error(`Column name "${newName}" already exists in table "${table.name}"`);
      }
    }
    const columns: readonly TableColumn[] = table.columns.map((col) =>
      col.id === columnId ? { ...col, name: newName } : col,
    );
    return { ...table, columns };
  },

  table_set_totals_function(table: Table, columnId: string, func: string): Table {
    const fn = func === 'none' ? null : (func as TotalsFunction);
    const columns: readonly TableColumn[] = table.columns.map((col) =>
      col.id === columnId ? { ...col, totalsFunction: fn } : col,
    );
    return { ...table, columns };
  },

  table_set_table_option(table: Table, option: string, value: boolean): Table {
    return { ...table, [option]: value };
  },

  table_toggle_totals_row(table: Table): Table {
    if (table.hasTotalsRow) {
      return {
        ...table,
        hasTotalsRow: false,
        range: { ...table.range, endRow: table.range.endRow - 1 },
      };
    } else {
      return {
        ...table,
        hasTotalsRow: true,
        range: { ...table.range, endRow: table.range.endRow + 1 },
      };
    }
  },

  table_get_data_range(table: Table): CellRange {
    return mockGetDataRange(table);
  },

  table_get_header_range(table: Table): CellRange | null {
    if (!table.hasHeaderRow) return null;
    return {
      startRow: table.range.startRow,
      startCol: table.range.startCol,
      endRow: table.range.startRow,
      endCol: table.range.endCol,
    };
  },

  table_get_totals_range(table: Table): CellRange | null {
    if (!table.hasTotalsRow) return null;
    return {
      startRow: table.range.endRow,
      startCol: table.range.startCol,
      endRow: table.range.endRow,
      endCol: table.range.endCol,
    };
  },

  table_get_column_data_range(table: Table, columnId: string): CellRange {
    const col = table.columns.find((c: TableColumn) => c.id === columnId);
    if (!col) throw new Error(`Column "${columnId}" not found in table "${table.name}"`);
    const gridCol = table.range.startCol + col.index;
    const dataRange = mockGetDataRange(table);
    return {
      startRow: dataRange.startRow,
      startCol: gridCol,
      endRow: dataRange.endRow,
      endCol: gridCol,
    };
  },

  table_get_column_by_name(table: Table, name: string): TableColumn | null {
    const lower = name.toLowerCase();
    return table.columns.find((c: TableColumn) => c.name.toLowerCase() === lower) ?? null;
  },

  table_get_column_by_id(table: Table, id: string): TableColumn | null {
    return table.columns.find((c: TableColumn) => c.id === id) ?? null;
  },

  table_get_column_at_grid_col(table: Table, gridCol: number): TableColumn | null {
    if (gridCol < table.range.startCol || gridCol > table.range.endCol) return null;
    const tableColIndex = gridCol - table.range.startCol;
    return table.columns[tableColIndex] ?? null;
  },

  table_is_in_table(table: Table, row: number, col: number): boolean {
    const { range } = table;
    return (
      row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol
    );
  },

  table_is_in_header_row(table: Table, row: number): boolean {
    return table.hasHeaderRow && row === table.range.startRow;
  },

  table_is_in_totals_row(table: Table, row: number): boolean {
    return table.hasTotalsRow && row === table.range.endRow;
  },

  table_is_in_data_range(table: Table, row: number, col: number): boolean {
    const dataRange = mockGetDataRange(table);
    return (
      row >= dataRange.startRow &&
      row <= dataRange.endRow &&
      col >= dataRange.startCol &&
      col <= dataRange.endCol
    );
  },

  table_validate_table_name(
    name: string,
    existingNames: readonly string[],
  ): { valid: boolean; reason?: string } {
    if (!name || name.trim().length === 0)
      return { valid: false, reason: 'Table name cannot be empty' };
    if (!/^[A-Za-z_]/.test(name))
      return { valid: false, reason: 'Table name must start with a letter or underscore' };
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      return {
        valid: false,
        reason: 'Table name can only contain letters, digits, and underscores',
      };
    const cellRefMatch = name.match(/^([A-Za-z]{1,3})(\d+)$/);
    if (cellRefMatch) {
      const letters = cellRefMatch[1].toUpperCase();
      const rowNum = parseInt(cellRefMatch[2], 10);
      let colNum = 0;
      for (let i = 0; i < letters.length; i++) {
        colNum = colNum * 26 + (letters.charCodeAt(i) - 64);
      }
      if (colNum >= 1 && colNum <= 16384 && rowNum >= 1 && rowNum <= 1048576) {
        return { valid: false, reason: 'Table name cannot be a cell reference' };
      }
    }
    const lowerName = name.toLowerCase();
    for (const existing of existingNames) {
      if (existing.toLowerCase() === lowerName)
        return { valid: false, reason: `Table name "${name}" already exists` };
    }
    return { valid: true };
  },

  table_generate_table_name(existingNames: readonly string[]): string {
    const lowerSet = new Set(existingNames.map((n: string) => n.toLowerCase()));
    let i = 1;
    while (lowerSet.has(`table${i}`)) i++;
    return `Table${i}`;
  },

  table_ranges_overlap(a: CellRange, b: CellRange): boolean {
    if (a.endCol < b.startCol || a.startCol > b.endCol) return false;
    if (a.endRow < b.startRow || a.startRow > b.endRow) return false;
    return true;
  },

  table_get_totals_formula(func: string, columnName: string): string {
    if (func === 'none' || func === 'custom') return '';
    const funcNum = SUBTOTAL_FUNCTION_NUMBER[func];
    if (funcNum === undefined) return '';
    return `=SUBTOTAL(${funcNum},[${escapeColumnNameForRef(columnName)}])`;
  },
};

jest.mock('../wasm-backend', () => ({
  getWasm: () => mockWasm,
  initTableWasm: jest.fn(),
  hasWasm: () => true,
}));

import {
  addColumn,
  createTable,
  generateTableName,
  getColumnAtGridCol,
  getColumnById,
  getColumnByName,
  getColumnDataRange,
  getDataRange,
  getHeaderRange,
  getTotalsFormula,
  getTotalsRange,
  isInDataRange,
  isInHeaderRow,
  isInTable,
  isInTotalsRow,
  removeColumn,
  renameColumn,
  resizeTable,
  setTableOption,
  setTotalsFunction,
  tablesOverlap,
  toggleTotalsRow,
  validateTableName,
} from '../table';

// =============================================================================
// Helpers
// =============================================================================

/** Create a basic table for tests: rows 0-5, cols 0-2 (header + 5 data rows, 3 columns) */
function makeTable(overrides?: Partial<Table>): Table {
  return createTable({
    id: 'tbl-1',
    name: 'Sales',
    sheetId: 'sheet-1',
    range: { startRow: 0, startCol: 0, endRow: 5, endCol: 2 },
    headerValues: ['Product', 'Price', 'Qty'],
    ...overrides,
  });
}

/** Create a table with totals row enabled */
function makeTableWithTotals(): Table {
  const t = makeTable();
  return setTableOption(t, 'hasTotalsRow', true);
}

// =============================================================================
// createTable
// =============================================================================

describe('createTable', () => {
  it('creates a table with correct basic properties', () => {
    const t = makeTable();
    expect(t.id).toBe('tbl-1');
    expect(t.name).toBe('Sales');
    expect(t.sheetId).toBe('sheet-1');
    expect(t.range).toEqual({ startRow: 0, startCol: 0, endRow: 5, endCol: 2 });
  });

  it('creates columns from headerValues', () => {
    const t = makeTable();
    expect(t.columns).toHaveLength(3);
    expect(t.columns[0].name).toBe('Product');
    expect(t.columns[1].name).toBe('Price');
    expect(t.columns[2].name).toBe('Qty');
  });

  it('assigns 0-based indices to columns', () => {
    const t = makeTable();
    expect(t.columns[0].index).toBe(0);
    expect(t.columns[1].index).toBe(1);
    expect(t.columns[2].index).toBe(2);
  });

  it('generates column ids from table id', () => {
    const t = makeTable();
    expect(t.columns[0].id).toBe('tbl-1-col-0');
    expect(t.columns[1].id).toBe('tbl-1-col-1');
    expect(t.columns[2].id).toBe('tbl-1-col-2');
  });

  it('sets default options', () => {
    const t = makeTable();
    expect(t.hasHeaderRow).toBe(true);
    expect(t.hasTotalsRow).toBe(false);
    expect(t.bandedRows).toBe(true);
    expect(t.bandedColumns).toBe(false);
    expect(t.emphasizeFirstColumn).toBe(false);
    expect(t.emphasizeLastColumn).toBe(false);
    expect(t.showFilterButtons).toBe(true);
  });

  it('uses default style when none specified', () => {
    const t = makeTable();
    expect(t.style).toBe('TableStyleMedium2');
  });

  it('uses custom style when specified', () => {
    const t = createTable({
      id: 'tbl-2',
      name: 'Data',
      sheetId: 'sheet-1',
      range: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
      headerValues: ['A', 'B'],
      style: 'TableStyleDark3',
    });
    expect(t.style).toBe('TableStyleDark3');
  });

  it('pads columns with generated names when fewer headerValues than columns', () => {
    const t = createTable({
      id: 'tbl-3',
      name: 'Wide',
      sheetId: 'sheet-1',
      range: { startRow: 0, startCol: 0, endRow: 3, endCol: 4 },
      headerValues: ['A', 'B'],
    });
    expect(t.columns).toHaveLength(5);
    expect(t.columns[0].name).toBe('A');
    expect(t.columns[1].name).toBe('B');
    expect(t.columns[2].name).toBe('Column3');
    expect(t.columns[3].name).toBe('Column4');
    expect(t.columns[4].name).toBe('Column5');
  });

  it('initializes all totals functions to null', () => {
    const t = makeTable();
    for (const col of t.columns) {
      expect(col.totalsFunction).toBeNull();
      expect(col.totalsLabel).toBeNull();
    }
  });

  it('creates a single-column table', () => {
    const t = createTable({
      id: 'tbl-single',
      name: 'Single',
      sheetId: 'sheet-1',
      range: { startRow: 0, startCol: 0, endRow: 3, endCol: 0 },
      headerValues: ['Only'],
    });
    expect(t.columns).toHaveLength(1);
    expect(t.columns[0].name).toBe('Only');
  });
});

// =============================================================================
// resizeTable
// =============================================================================

describe('resizeTable', () => {
  it('expands rows without changing columns', () => {
    const t = makeTable();
    const resized = resizeTable(t, { startRow: 0, startCol: 0, endRow: 10, endCol: 2 });
    expect(resized.range.endRow).toBe(10);
    expect(resized.columns).toHaveLength(3);
  });

  it('contracts rows without changing columns', () => {
    const t = makeTable();
    const resized = resizeTable(t, { startRow: 0, startCol: 0, endRow: 2, endCol: 2 });
    expect(resized.range.endRow).toBe(2);
    expect(resized.columns).toHaveLength(3);
  });

  it('expands columns by adding new ones', () => {
    const t = makeTable();
    const resized = resizeTable(t, { startRow: 0, startCol: 0, endRow: 5, endCol: 4 });
    expect(resized.columns).toHaveLength(5);
    expect(resized.columns[3].name).toBe('Column4');
    expect(resized.columns[4].name).toBe('Column5');
  });

  it('contracts columns by removing from end', () => {
    const t = makeTable();
    const resized = resizeTable(t, { startRow: 0, startCol: 0, endRow: 5, endCol: 1 });
    expect(resized.columns).toHaveLength(2);
    expect(resized.columns[0].name).toBe('Product');
    expect(resized.columns[1].name).toBe('Price');
  });

  it('re-indexes columns after resize', () => {
    const t = makeTable();
    const resized = resizeTable(t, { startRow: 0, startCol: 0, endRow: 5, endCol: 4 });
    resized.columns.forEach((col, idx) => {
      expect(col.index).toBe(idx);
    });
  });

  it('preserves existing column properties', () => {
    let t = makeTable();
    t = setTotalsFunction(t, t.columns[0].id, 'sum');
    const resized = resizeTable(t, { startRow: 0, startCol: 0, endRow: 5, endCol: 4 });
    expect(resized.columns[0].totalsFunction).toBe('sum');
    expect(resized.columns[0].name).toBe('Product');
  });

  it('does not mutate the original table', () => {
    const t = makeTable();
    const resized = resizeTable(t, { startRow: 0, startCol: 0, endRow: 10, endCol: 5 });
    expect(t.range.endRow).toBe(5);
    expect(t.range.endCol).toBe(2);
    expect(t.columns).toHaveLength(3);
    expect(resized).not.toBe(t);
  });

  it('handles same-size resize', () => {
    const t = makeTable();
    const resized = resizeTable(t, { ...t.range });
    expect(resized.columns).toHaveLength(t.columns.length);
    expect(resized.range).toEqual(t.range);
  });

  it('produces unique column IDs after shrink-then-expand cycle', () => {
    const t = makeTable(); // 3 columns: col-0, col-1, col-2
    const originalIds = t.columns.map((c) => c.id);

    // Shrink to 1 column
    const shrunk = resizeTable(t, { startRow: 0, startCol: 0, endRow: 5, endCol: 0 });
    expect(shrunk.columns).toHaveLength(1);

    // Expand back to 3 columns — new IDs must not collide with original IDs
    const expanded = resizeTable(shrunk, { startRow: 0, startCol: 0, endRow: 5, endCol: 2 });
    expect(expanded.columns).toHaveLength(3);

    const expandedIds = expanded.columns.map((c) => c.id);
    // All IDs should be unique
    expect(new Set(expandedIds).size).toBe(3);

    // The two new columns should NOT reuse the old IDs that were removed
    const newColumnIds = expandedIds.slice(1); // the 2 newly added columns
    for (const newId of newColumnIds) {
      expect(originalIds).not.toContain(newId);
    }
  });
});

// =============================================================================
// addColumn
// =============================================================================

describe('addColumn', () => {
  it('adds a column at position 0', () => {
    const t = makeTable();
    const updated = addColumn(t, { id: 'new-col', name: 'Region', position: 0 });
    expect(updated.columns).toHaveLength(4);
    expect(updated.columns[0].name).toBe('Region');
    expect(updated.columns[1].name).toBe('Product');
  });

  it('adds a column at the end', () => {
    const t = makeTable();
    const updated = addColumn(t, { id: 'new-col', name: 'Total', position: 3 });
    expect(updated.columns).toHaveLength(4);
    expect(updated.columns[3].name).toBe('Total');
  });

  it('adds a column in the middle', () => {
    const t = makeTable();
    const updated = addColumn(t, { id: 'mid-col', name: 'Category', position: 1 });
    expect(updated.columns).toHaveLength(4);
    expect(updated.columns[0].name).toBe('Product');
    expect(updated.columns[1].name).toBe('Category');
    expect(updated.columns[2].name).toBe('Price');
    expect(updated.columns[3].name).toBe('Qty');
  });

  it('expands the table range by one column', () => {
    const t = makeTable();
    const updated = addColumn(t, { id: 'new-col', name: 'Extra', position: 1 });
    expect(updated.range.endCol).toBe(t.range.endCol + 1);
  });

  it('re-indexes all columns', () => {
    const t = makeTable();
    const updated = addColumn(t, { id: 'new-col', name: 'Region', position: 0 });
    updated.columns.forEach((col, idx) => {
      expect(col.index).toBe(idx);
    });
  });

  it('handles position beyond column count by appending at end', () => {
    const t = makeTable(); // 3 columns
    const updated = addColumn(t, { id: 'far-col', name: 'Far', position: 100 });
    expect(updated.columns).toHaveLength(4);
    // splice with index > length appends at the end
    expect(updated.columns[3].name).toBe('Far');
  });

  it('handles negative position by clamping to 0 (inserting at beginning)', () => {
    const t = makeTable(); // 3 columns
    const updated = addColumn(t, { id: 'neg-col', name: 'Neg', position: -1 });
    expect(updated.columns).toHaveLength(4);
    expect(updated.columns[0].name).toBe('Neg');
  });

  it('does not mutate original table', () => {
    const t = makeTable();
    addColumn(t, { id: 'new-col', name: 'Extra', position: 0 });
    expect(t.columns).toHaveLength(3);
  });
});

// =============================================================================
// removeColumn
// =============================================================================

describe('removeColumn', () => {
  it('removes a column by id', () => {
    const t = makeTable();
    const colId = t.columns[1].id; // Price
    const updated = removeColumn(t, colId);
    expect(updated.columns).toHaveLength(2);
    expect(updated.columns[0].name).toBe('Product');
    expect(updated.columns[1].name).toBe('Qty');
  });

  it('contracts the table range by one column', () => {
    const t = makeTable();
    const updated = removeColumn(t, t.columns[0].id);
    expect(updated.range.endCol).toBe(t.range.endCol - 1);
  });

  it('re-indexes remaining columns', () => {
    const t = makeTable();
    const updated = removeColumn(t, t.columns[0].id);
    updated.columns.forEach((col, idx) => {
      expect(col.index).toBe(idx);
    });
  });

  it('returns the same table when column id is not found', () => {
    const t = makeTable();
    const updated = removeColumn(t, 'nonexistent-id');
    expect(updated).toBe(t);
  });

  it('returns the table unchanged when it has only one column', () => {
    const t = createTable({
      id: 'tbl-single',
      name: 'Single',
      sheetId: 'sheet-1',
      range: { startRow: 0, startCol: 0, endRow: 3, endCol: 0 },
      headerValues: ['Only'],
    });
    const updated = removeColumn(t, t.columns[0].id);
    expect(updated).toBe(t);
    expect(updated.columns).toHaveLength(1);
    expect(updated.range.endCol).toBe(0);
  });

  it('does not mutate original table', () => {
    const t = makeTable();
    removeColumn(t, t.columns[0].id);
    expect(t.columns).toHaveLength(3);
  });
});

// =============================================================================
// renameColumn
// =============================================================================

describe('renameColumn', () => {
  it('renames a column by id', () => {
    const t = makeTable();
    const updated = renameColumn(t, t.columns[0].id, 'Item');
    expect(updated.columns[0].name).toBe('Item');
  });

  it('does not change other columns', () => {
    const t = makeTable();
    const updated = renameColumn(t, t.columns[0].id, 'Item');
    expect(updated.columns[1].name).toBe('Price');
    expect(updated.columns[2].name).toBe('Qty');
  });

  it('preserves other column properties', () => {
    let t = makeTable();
    t = setTotalsFunction(t, t.columns[0].id, 'sum');
    const updated = renameColumn(t, t.columns[0].id, 'Item');
    expect(updated.columns[0].totalsFunction).toBe('sum');
    expect(updated.columns[0].index).toBe(0);
  });

  it('does not mutate original table', () => {
    const t = makeTable();
    renameColumn(t, t.columns[0].id, 'Item');
    expect(t.columns[0].name).toBe('Product');
  });
});

// =============================================================================
// setTotalsFunction
// =============================================================================

describe('setTotalsFunction', () => {
  it('sets a totals function on a column', () => {
    const t = makeTable();
    const updated = setTotalsFunction(t, t.columns[1].id, 'sum');
    expect(updated.columns[1].totalsFunction).toBe('sum');
  });

  it('clears a totals function by setting null', () => {
    let t = makeTable();
    t = setTotalsFunction(t, t.columns[1].id, 'sum');
    const updated = setTotalsFunction(t, t.columns[1].id, null);
    expect(updated.columns[1].totalsFunction).toBeNull();
  });

  it('does not affect other columns', () => {
    const t = makeTable();
    const updated = setTotalsFunction(t, t.columns[1].id, 'average');
    expect(updated.columns[0].totalsFunction).toBeNull();
    expect(updated.columns[2].totalsFunction).toBeNull();
  });

  it('does not mutate original table', () => {
    const t = makeTable();
    setTotalsFunction(t, t.columns[0].id, 'count');
    expect(t.columns[0].totalsFunction).toBeNull();
  });
});

// =============================================================================
// setTableOption
// =============================================================================

describe('setTableOption', () => {
  it('toggles bandedRows', () => {
    const t = makeTable();
    expect(t.bandedRows).toBe(true);
    const updated = setTableOption(t, 'bandedRows', false);
    expect(updated.bandedRows).toBe(false);
  });

  it('toggles bandedColumns', () => {
    const t = makeTable();
    const updated = setTableOption(t, 'bandedColumns', true);
    expect(updated.bandedColumns).toBe(true);
  });

  it('toggles emphasizeFirstColumn', () => {
    const t = makeTable();
    const updated = setTableOption(t, 'emphasizeFirstColumn', true);
    expect(updated.emphasizeFirstColumn).toBe(true);
  });

  it('toggles emphasizeLastColumn', () => {
    const t = makeTable();
    const updated = setTableOption(t, 'emphasizeLastColumn', true);
    expect(updated.emphasizeLastColumn).toBe(true);
  });

  it('toggles hasTotalsRow', () => {
    const t = makeTable();
    expect(t.hasTotalsRow).toBe(false);
    const updated = setTableOption(t, 'hasTotalsRow', true);
    expect(updated.hasTotalsRow).toBe(true);
  });

  it('toggles showFilterButtons', () => {
    const t = makeTable();
    const updated = setTableOption(t, 'showFilterButtons', false);
    expect(updated.showFilterButtons).toBe(false);
  });

  it('does not mutate original table', () => {
    const t = makeTable();
    setTableOption(t, 'hasTotalsRow', true);
    expect(t.hasTotalsRow).toBe(false);
  });
});

// =============================================================================
// getDataRange
// =============================================================================

describe('getDataRange', () => {
  it('excludes header row when hasHeaderRow is true', () => {
    const t = makeTable(); // range 0-5, hasHeaderRow=true, hasTotalsRow=false
    const dr = getDataRange(t);
    expect(dr.startRow).toBe(1); // skip header at row 0
    expect(dr.endRow).toBe(5);
    expect(dr.startCol).toBe(0);
    expect(dr.endCol).toBe(2);
  });

  it('excludes totals row when hasTotalsRow is true', () => {
    const t = makeTableWithTotals(); // range 0-5, both header and totals
    const dr = getDataRange(t);
    expect(dr.startRow).toBe(1);
    expect(dr.endRow).toBe(4); // row 5 is totals
  });

  it('includes all rows when no header and no totals', () => {
    let t = makeTable();
    t = { ...t, hasHeaderRow: false, hasTotalsRow: false };
    const dr = getDataRange(t);
    expect(dr.startRow).toBe(0);
    expect(dr.endRow).toBe(5);
  });

  it('spans all columns', () => {
    const t = makeTable();
    const dr = getDataRange(t);
    expect(dr.startCol).toBe(0);
    expect(dr.endCol).toBe(2);
  });
});

// =============================================================================
// getHeaderRange
// =============================================================================

describe('getHeaderRange', () => {
  it('returns header range when table has header', () => {
    const t = makeTable();
    const hr = getHeaderRange(t);
    expect(hr).toEqual({ startRow: 0, startCol: 0, endRow: 0, endCol: 2 });
  });

  it('returns null when table has no header', () => {
    const t = { ...makeTable(), hasHeaderRow: false };
    expect(getHeaderRange(t)).toBeNull();
  });

  it('header range is always one row', () => {
    const t = makeTable();
    const hr = getHeaderRange(t)!;
    expect(hr.startRow).toBe(hr.endRow);
  });
});

// =============================================================================
// getTotalsRange
// =============================================================================

describe('getTotalsRange', () => {
  it('returns totals range when table has totals', () => {
    const t = makeTableWithTotals(); // range 0-5
    const tr = getTotalsRange(t);
    expect(tr).toEqual({ startRow: 5, startCol: 0, endRow: 5, endCol: 2 });
  });

  it('returns null when table has no totals', () => {
    const t = makeTable();
    expect(getTotalsRange(t)).toBeNull();
  });

  it('totals range is always the last row', () => {
    const t = makeTableWithTotals();
    const tr = getTotalsRange(t)!;
    expect(tr.startRow).toBe(t.range.endRow);
    expect(tr.endRow).toBe(t.range.endRow);
  });
});

// =============================================================================
// getColumnDataRange
// =============================================================================

describe('getColumnDataRange', () => {
  it('returns data range for a specific column', () => {
    const t = makeTable();
    const cdr = getColumnDataRange(t, t.columns[1].id); // Price at grid col 1
    expect(cdr).toEqual({ startRow: 1, startCol: 1, endRow: 5, endCol: 1 });
  });

  it('works for the first column', () => {
    const t = makeTable();
    const cdr = getColumnDataRange(t, t.columns[0].id);
    expect(cdr.startCol).toBe(0);
    expect(cdr.endCol).toBe(0);
  });

  it('works for the last column', () => {
    const t = makeTable();
    const cdr = getColumnDataRange(t, t.columns[2].id);
    expect(cdr.startCol).toBe(2);
    expect(cdr.endCol).toBe(2);
  });

  it('excludes header and totals rows', () => {
    const t = makeTableWithTotals();
    const cdr = getColumnDataRange(t, t.columns[0].id);
    expect(cdr.startRow).toBe(1); // header excluded
    expect(cdr.endRow).toBe(4); // totals excluded
  });

  it('throws for unknown column id', () => {
    const t = makeTable();
    expect(() => getColumnDataRange(t, 'nonexistent')).toThrow();
  });

  it('works for a table starting at non-zero position', () => {
    const t = createTable({
      id: 'tbl-offset',
      name: 'Offset',
      sheetId: 'sheet-1',
      range: { startRow: 5, startCol: 3, endRow: 10, endCol: 5 },
      headerValues: ['A', 'B', 'C'],
    });
    const cdr = getColumnDataRange(t, t.columns[1].id);
    expect(cdr).toEqual({ startRow: 6, startCol: 4, endRow: 10, endCol: 4 });
  });
});

// =============================================================================
// Column Lookup
// =============================================================================

describe('getColumnByName', () => {
  it('finds column by exact name', () => {
    const t = makeTable();
    const col = getColumnByName(t, 'Price');
    expect(col).not.toBeNull();
    expect(col!.name).toBe('Price');
  });

  it('finds column case-insensitively', () => {
    const t = makeTable();
    expect(getColumnByName(t, 'price')).not.toBeNull();
    expect(getColumnByName(t, 'PRICE')).not.toBeNull();
    expect(getColumnByName(t, 'pRiCe')).not.toBeNull();
  });

  it('returns null for non-existent name', () => {
    const t = makeTable();
    expect(getColumnByName(t, 'Missing')).toBeNull();
  });
});

describe('getColumnById', () => {
  it('finds column by id', () => {
    const t = makeTable();
    const col = getColumnById(t, t.columns[2].id);
    expect(col).not.toBeNull();
    expect(col!.name).toBe('Qty');
  });

  it('returns null for non-existent id', () => {
    const t = makeTable();
    expect(getColumnById(t, 'no-such-id')).toBeNull();
  });
});

describe('getColumnAtGridCol', () => {
  it('returns the column at a given grid column', () => {
    const t = makeTable(); // startCol=0, endCol=2
    expect(getColumnAtGridCol(t, 0)!.name).toBe('Product');
    expect(getColumnAtGridCol(t, 1)!.name).toBe('Price');
    expect(getColumnAtGridCol(t, 2)!.name).toBe('Qty');
  });

  it('returns null for grid col outside table', () => {
    const t = makeTable();
    expect(getColumnAtGridCol(t, -1)).toBeNull();
    expect(getColumnAtGridCol(t, 3)).toBeNull();
    expect(getColumnAtGridCol(t, 100)).toBeNull();
  });

  it('works for table starting at non-zero column', () => {
    const t = createTable({
      id: 'tbl-off',
      name: 'Off',
      sheetId: 'sheet-1',
      range: { startRow: 0, startCol: 5, endRow: 3, endCol: 7 },
      headerValues: ['X', 'Y', 'Z'],
    });
    expect(getColumnAtGridCol(t, 4)).toBeNull();
    expect(getColumnAtGridCol(t, 5)!.name).toBe('X');
    expect(getColumnAtGridCol(t, 6)!.name).toBe('Y');
    expect(getColumnAtGridCol(t, 7)!.name).toBe('Z');
    expect(getColumnAtGridCol(t, 8)).toBeNull();
  });
});

// =============================================================================
// Hit Testing
// =============================================================================

describe('isInTable', () => {
  it('returns true for cells inside the table', () => {
    const t = makeTable(); // rows 0-5, cols 0-2
    expect(isInTable(t, 0, 0)).toBe(true);
    expect(isInTable(t, 5, 2)).toBe(true);
    expect(isInTable(t, 3, 1)).toBe(true);
  });

  it('returns false for cells outside the table', () => {
    const t = makeTable();
    expect(isInTable(t, -1, 0)).toBe(false);
    expect(isInTable(t, 0, -1)).toBe(false);
    expect(isInTable(t, 6, 0)).toBe(false);
    expect(isInTable(t, 0, 3)).toBe(false);
    expect(isInTable(t, 6, 3)).toBe(false);
  });

  it('returns true for boundary cells', () => {
    const t = makeTable();
    expect(isInTable(t, 0, 0)).toBe(true); // top-left
    expect(isInTable(t, 0, 2)).toBe(true); // top-right
    expect(isInTable(t, 5, 0)).toBe(true); // bottom-left
    expect(isInTable(t, 5, 2)).toBe(true); // bottom-right
  });
});

describe('isInHeaderRow', () => {
  it('returns true for the header row', () => {
    const t = makeTable(); // header at row 0
    expect(isInHeaderRow(t, 0)).toBe(true);
  });

  it('returns false for non-header rows', () => {
    const t = makeTable();
    expect(isInHeaderRow(t, 1)).toBe(false);
    expect(isInHeaderRow(t, 5)).toBe(false);
    expect(isInHeaderRow(t, -1)).toBe(false);
  });

  it('returns false when table has no header', () => {
    const t = { ...makeTable(), hasHeaderRow: false };
    expect(isInHeaderRow(t, 0)).toBe(false);
  });
});

describe('isInTotalsRow', () => {
  it('returns true for the totals row', () => {
    const t = makeTableWithTotals(); // totals at row 5
    expect(isInTotalsRow(t, 5)).toBe(true);
  });

  it('returns false for non-totals rows', () => {
    const t = makeTableWithTotals();
    expect(isInTotalsRow(t, 0)).toBe(false);
    expect(isInTotalsRow(t, 4)).toBe(false);
  });

  it('returns false when table has no totals', () => {
    const t = makeTable();
    expect(isInTotalsRow(t, 5)).toBe(false);
  });
});

describe('isInDataRange', () => {
  it('returns true for data cells', () => {
    const t = makeTable(); // data rows 1-5, cols 0-2
    expect(isInDataRange(t, 1, 0)).toBe(true);
    expect(isInDataRange(t, 3, 1)).toBe(true);
    expect(isInDataRange(t, 5, 2)).toBe(true);
  });

  it('returns false for header row', () => {
    const t = makeTable();
    expect(isInDataRange(t, 0, 0)).toBe(false);
    expect(isInDataRange(t, 0, 1)).toBe(false);
  });

  it('returns false for totals row', () => {
    const t = makeTableWithTotals(); // totals at row 5
    expect(isInDataRange(t, 5, 0)).toBe(false);
  });

  it('returns false for cells outside table column range', () => {
    const t = makeTable();
    expect(isInDataRange(t, 3, 3)).toBe(false);
    expect(isInDataRange(t, 3, -1)).toBe(false);
  });

  it('returns false for cells outside table row range', () => {
    const t = makeTable();
    expect(isInDataRange(t, 6, 0)).toBe(false);
    expect(isInDataRange(t, -1, 0)).toBe(false);
  });

  it('with header and totals, only data rows are in data range', () => {
    const t = makeTableWithTotals(); // header=0, data=1-4, totals=5
    expect(isInDataRange(t, 0, 1)).toBe(false); // header
    expect(isInDataRange(t, 1, 1)).toBe(true); // first data
    expect(isInDataRange(t, 4, 1)).toBe(true); // last data
    expect(isInDataRange(t, 5, 1)).toBe(false); // totals
  });
});

// =============================================================================
// validateTableName
// =============================================================================

describe('validateTableName', () => {
  it('accepts valid names', () => {
    expect(validateTableName('Sales', [])).toEqual({ valid: true });
    expect(validateTableName('Table1', [])).toEqual({ valid: true });
    expect(validateTableName('_private', [])).toEqual({ valid: true });
    expect(validateTableName('MyData2024', [])).toEqual({ valid: true });
  });

  it('rejects empty names', () => {
    const result = validateTableName('', []);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('empty');
  });

  it('rejects whitespace-only names', () => {
    const result = validateTableName('   ', []);
    expect(result.valid).toBe(false);
  });

  it('rejects names starting with a digit', () => {
    const result = validateTableName('1Table', []);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('letter or underscore');
  });

  it('rejects names with special characters', () => {
    expect(validateTableName('My Table', []).valid).toBe(false);
    expect(validateTableName('table!', []).valid).toBe(false);
    expect(validateTableName('table.1', []).valid).toBe(false);
    expect(validateTableName('my-table', []).valid).toBe(false);
  });

  it('rejects cell references like A1, BB99, XFD1', () => {
    expect(validateTableName('A1', []).valid).toBe(false);
    expect(validateTableName('B99', []).valid).toBe(false);
    expect(validateTableName('BB99', []).valid).toBe(false);
    expect(validateTableName('XFD1', []).valid).toBe(false);
  });

  it('accepts names beyond XFD column range', () => {
    // XFE1 and beyond should be allowed since XFD is the last Excel column
    expect(validateTableName('XFE1', []).valid).toBe(true);
    expect(validateTableName('ZZZ1', []).valid).toBe(true);
  });

  it('rejects duplicate names (case-insensitive)', () => {
    const result = validateTableName('Sales', ['Sales']);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('already exists');
  });

  it('rejects duplicate names regardless of case', () => {
    expect(validateTableName('sales', ['Sales']).valid).toBe(false);
    expect(validateTableName('SALES', ['sales']).valid).toBe(false);
  });

  it('allows names not in existing list', () => {
    expect(validateTableName('NewTable', ['Sales', 'Data']).valid).toBe(true);
  });

  it('accepts A0 (row 0 is not a valid cell reference)', () => {
    expect(validateTableName('A0', []).valid).toBe(true);
  });

  it('accepts A1048577 (exceeds max Excel row 1048576)', () => {
    expect(validateTableName('A1048577', []).valid).toBe(true);
  });

  it('accepts XFE1 (exceeds max Excel column XFD)', () => {
    expect(validateTableName('XFE1', []).valid).toBe(true);
  });

  it('rejects XFD1 (valid cell reference)', () => {
    expect(validateTableName('XFD1', []).valid).toBe(false);
  });

  it('rejects A1 (valid cell reference)', () => {
    expect(validateTableName('A1', []).valid).toBe(false);
  });

  it('rejects ZZ100 (valid cell reference)', () => {
    expect(validateTableName('ZZ100', []).valid).toBe(false);
  });
});

// =============================================================================
// generateTableName
// =============================================================================

describe('generateTableName', () => {
  it('generates Table1 when no existing tables', () => {
    expect(generateTableName([])).toBe('Table1');
  });

  it('generates Table2 when Table1 exists', () => {
    expect(generateTableName(['Table1'])).toBe('Table2');
  });

  it('finds first available number', () => {
    expect(generateTableName(['Table1', 'Table2', 'Table3'])).toBe('Table4');
  });

  it('fills gaps in numbering', () => {
    expect(generateTableName(['Table1', 'Table3'])).toBe('Table2');
  });

  it('is case-insensitive', () => {
    expect(generateTableName(['table1', 'TABLE2'])).toBe('Table3');
  });

  it('handles large numbers', () => {
    const existing = Array.from({ length: 100 }, (_, i) => `Table${i + 1}`);
    expect(generateTableName(existing)).toBe('Table101');
  });
});

// =============================================================================
// tablesOverlap
// =============================================================================

describe('tablesOverlap', () => {
  it('detects overlap when ranges intersect', () => {
    const a: CellRange = { startRow: 0, startCol: 0, endRow: 5, endCol: 3 };
    const b: CellRange = { startRow: 3, startCol: 2, endRow: 8, endCol: 6 };
    expect(tablesOverlap(a, b)).toBe(true);
  });

  it('detects overlap at a single corner cell', () => {
    const a: CellRange = { startRow: 0, startCol: 0, endRow: 3, endCol: 3 };
    const b: CellRange = { startRow: 3, startCol: 3, endRow: 6, endCol: 6 };
    expect(tablesOverlap(a, b)).toBe(true);
  });

  it('detects overlap when one range contains the other', () => {
    const a: CellRange = { startRow: 0, startCol: 0, endRow: 10, endCol: 10 };
    const b: CellRange = { startRow: 2, startCol: 2, endRow: 5, endCol: 5 };
    expect(tablesOverlap(a, b)).toBe(true);
    expect(tablesOverlap(b, a)).toBe(true);
  });

  it('returns false when ranges are separated horizontally', () => {
    const a: CellRange = { startRow: 0, startCol: 0, endRow: 5, endCol: 3 };
    const b: CellRange = { startRow: 0, startCol: 4, endRow: 5, endCol: 7 };
    expect(tablesOverlap(a, b)).toBe(false);
  });

  it('returns false when ranges are separated vertically', () => {
    const a: CellRange = { startRow: 0, startCol: 0, endRow: 3, endCol: 3 };
    const b: CellRange = { startRow: 4, startCol: 0, endRow: 7, endCol: 3 };
    expect(tablesOverlap(a, b)).toBe(false);
  });

  it('returns false when ranges are diagonally separated', () => {
    const a: CellRange = { startRow: 0, startCol: 0, endRow: 2, endCol: 2 };
    const b: CellRange = { startRow: 3, startCol: 3, endRow: 5, endCol: 5 };
    expect(tablesOverlap(a, b)).toBe(false);
  });

  it('is symmetric', () => {
    const a: CellRange = { startRow: 0, startCol: 0, endRow: 5, endCol: 3 };
    const b: CellRange = { startRow: 3, startCol: 2, endRow: 8, endCol: 6 };
    expect(tablesOverlap(a, b)).toBe(tablesOverlap(b, a));
  });

  it('detects overlap for same range', () => {
    const a: CellRange = { startRow: 0, startCol: 0, endRow: 5, endCol: 3 };
    expect(tablesOverlap(a, a)).toBe(true);
  });

  it('detects overlap for single-cell ranges', () => {
    const a: CellRange = { startRow: 3, startCol: 3, endRow: 3, endCol: 3 };
    const b: CellRange = { startRow: 3, startCol: 3, endRow: 3, endCol: 3 };
    expect(tablesOverlap(a, b)).toBe(true);
  });

  it('returns false for adjacent single-cell ranges', () => {
    const a: CellRange = { startRow: 3, startCol: 3, endRow: 3, endCol: 3 };
    const b: CellRange = { startRow: 3, startCol: 4, endRow: 3, endCol: 4 };
    expect(tablesOverlap(a, b)).toBe(false);
  });
});

// =============================================================================
// getTotalsFormula
// =============================================================================

describe('getTotalsFormula', () => {
  it('generates correct SUBTOTAL formula for sum', () => {
    expect(getTotalsFormula('sum', 'Sales')).toBe('=SUBTOTAL(109,[Sales])');
  });

  it('generates correct SUBTOTAL formula for average', () => {
    expect(getTotalsFormula('average', 'Price')).toBe('=SUBTOTAL(101,[Price])');
  });

  it('generates correct SUBTOTAL formula for count', () => {
    expect(getTotalsFormula('count', 'Items')).toBe('=SUBTOTAL(102,[Items])');
  });

  it('generates correct SUBTOTAL formula for countNums', () => {
    expect(getTotalsFormula('countNums', 'Values')).toBe('=SUBTOTAL(103,[Values])');
  });

  it('generates correct SUBTOTAL formula for max', () => {
    expect(getTotalsFormula('max', 'Score')).toBe('=SUBTOTAL(104,[Score])');
  });

  it('generates correct SUBTOTAL formula for min', () => {
    expect(getTotalsFormula('min', 'Score')).toBe('=SUBTOTAL(105,[Score])');
  });

  it('generates correct SUBTOTAL formula for stdDev', () => {
    expect(getTotalsFormula('stdDev', 'Deviation')).toBe('=SUBTOTAL(107,[Deviation])');
  });

  it('generates correct SUBTOTAL formula for var', () => {
    expect(getTotalsFormula('var', 'Variance')).toBe('=SUBTOTAL(110,[Variance])');
  });

  it('returns empty string for none', () => {
    expect(getTotalsFormula('none', 'Sales')).toBe('');
  });

  it('returns empty string for custom', () => {
    expect(getTotalsFormula('custom', 'Sales')).toBe('');
  });

  it('handles column names with spaces (no escaping needed)', () => {
    expect(getTotalsFormula('sum', 'Total Sales')).toBe('=SUBTOTAL(109,[Total Sales])');
  });
});

// =============================================================================
// Immutability / Purity Checks
// =============================================================================

describe('immutability', () => {
  it('createTable returns a new object each time', () => {
    const a = makeTable();
    const b = makeTable();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('chaining operations produces independent snapshots', () => {
    const t0 = makeTable();
    const t1 = setTableOption(t0, 'hasTotalsRow', true);
    const t2 = renameColumn(t1, t1.columns[0].id, 'Item');
    const t3 = setTotalsFunction(t2, t2.columns[1].id, 'sum');

    expect(t0.hasTotalsRow).toBe(false);
    expect(t1.hasTotalsRow).toBe(true);
    expect(t1.columns[0].name).toBe('Product');
    expect(t2.columns[0].name).toBe('Item');
    expect(t2.columns[1].totalsFunction).toBeNull();
    expect(t3.columns[1].totalsFunction).toBe('sum');
  });

  it('resizeTable does not share column references', () => {
    const t = makeTable();
    const resized = resizeTable(t, { startRow: 0, startCol: 0, endRow: 5, endCol: 4 });
    // Modify a column on the resized table to verify isolation
    const modified = renameColumn(resized, resized.columns[0].id, 'Changed');
    expect(t.columns[0].name).toBe('Product');
    expect(modified.columns[0].name).toBe('Changed');
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('edge cases', () => {
  it('table with only header row (1 row total)', () => {
    const t = createTable({
      id: 'tbl-tiny',
      name: 'Tiny',
      sheetId: 'sheet-1',
      range: { startRow: 0, startCol: 0, endRow: 1, endCol: 0 },
      headerValues: ['A'],
    });
    expect(getHeaderRange(t)).toEqual({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
    const dr = getDataRange(t);
    expect(dr.startRow).toBe(1);
    expect(dr.endRow).toBe(1);
  });

  it('table with header and totals but only 1 data row', () => {
    const t = createTable({
      id: 'tbl-min',
      name: 'Min',
      sheetId: 'sheet-1',
      range: { startRow: 0, startCol: 0, endRow: 2, endCol: 1 },
      headerValues: ['X', 'Y'],
    });
    const withTotals = setTableOption(t, 'hasTotalsRow', true);
    const dr = getDataRange(withTotals);
    expect(dr.startRow).toBe(1);
    expect(dr.endRow).toBe(1); // only row 1 is data
  });

  it('table at large offset', () => {
    const t = createTable({
      id: 'tbl-far',
      name: 'Far',
      sheetId: 'sheet-1',
      range: { startRow: 1000, startCol: 500, endRow: 1010, endCol: 503 },
      headerValues: ['A', 'B', 'C', 'D'],
    });
    expect(isInTable(t, 1000, 500)).toBe(true);
    expect(isInTable(t, 1010, 503)).toBe(true);
    expect(isInTable(t, 999, 500)).toBe(false);
    expect(isInTable(t, 1000, 504)).toBe(false);
    expect(isInHeaderRow(t, 1000)).toBe(true);
    expect(isInHeaderRow(t, 1001)).toBe(false);
  });

  it('empty headerValues still creates columns from range', () => {
    const t = createTable({
      id: 'tbl-empty-hdr',
      name: 'EmptyHdr',
      sheetId: 'sheet-1',
      range: { startRow: 0, startCol: 0, endRow: 3, endCol: 2 },
      headerValues: [],
    });
    expect(t.columns).toHaveLength(3);
    expect(t.columns[0].name).toBe('Column1');
    expect(t.columns[1].name).toBe('Column2');
    expect(t.columns[2].name).toBe('Column3');
  });
});

// =============================================================================
// getTotalsFormula — special character escaping
// =============================================================================

describe('getTotalsFormula with special characters', () => {
  it('escapes column name containing [ and ]', () => {
    // "Sales [Q1]" should be escaped so the structured reference is valid
    expect(getTotalsFormula('sum', 'Sales [Q1]')).toBe("=SUBTOTAL(109,['Sales [[Q1]]'])");
  });

  it('escapes column name containing single quote', () => {
    expect(getTotalsFormula('sum', "It's")).toBe("=SUBTOTAL(109,['It''s'])");
  });

  it('escapes column name containing #', () => {
    expect(getTotalsFormula('sum', 'Item #1')).toBe("=SUBTOTAL(109,['Item #1'])");
  });

  it('escapes column name containing @', () => {
    expect(getTotalsFormula('sum', 'user@email')).toBe("=SUBTOTAL(109,['user@email'])");
  });

  it('escapes column name with multiple special chars', () => {
    expect(getTotalsFormula('average', "Col[#1]'s")).toBe("=SUBTOTAL(101,['Col[[#1]]''s'])");
  });

  it('does not escape column name without special chars', () => {
    expect(getTotalsFormula('sum', 'Revenue 2024')).toBe('=SUBTOTAL(109,[Revenue 2024])');
  });
});

// =============================================================================
// Range validation
// =============================================================================

describe('range validation', () => {
  it('createTable throws for inverted row range', () => {
    expect(() =>
      createTable({
        id: 'tbl-bad',
        name: 'Bad',
        sheetId: 'sheet-1',
        range: { startRow: 5, startCol: 0, endRow: 2, endCol: 2 },
        headerValues: ['A', 'B', 'C'],
      }),
    ).toThrow(/startRow.*endRow/);
  });

  it('createTable throws for inverted column range', () => {
    expect(() =>
      createTable({
        id: 'tbl-bad',
        name: 'Bad',
        sheetId: 'sheet-1',
        range: { startRow: 0, startCol: 5, endRow: 3, endCol: 2 },
        headerValues: ['A'],
      }),
    ).toThrow(/startCol.*endCol/);
  });

  it('resizeTable throws for inverted row range', () => {
    const t = makeTable();
    expect(() => resizeTable(t, { startRow: 10, startCol: 0, endRow: 5, endCol: 2 })).toThrow(
      /startRow.*endRow/,
    );
  });

  it('resizeTable throws for zero-column range (startCol > endCol)', () => {
    const t = makeTable();
    expect(() => resizeTable(t, { startRow: 0, startCol: 3, endRow: 5, endCol: 2 })).toThrow(
      /startCol.*endCol/,
    );
  });
});

// =============================================================================
// Column name uniqueness
// =============================================================================

describe('column name uniqueness', () => {
  it('addColumn appends numeric suffix when name already exists', () => {
    const t = makeTable(); // has "Product", "Price", "Qty"
    const updated = addColumn(t, { id: 'dup-col', name: 'Product', position: 1 });
    expect(updated.columns).toHaveLength(4);
    // The new column should have a deduplicated name
    expect(updated.columns[1].name).toBe('Product2');
  });

  it('addColumn appends suffix repeatedly until unique', () => {
    let t = makeTable(); // has "Product", "Price", "Qty"
    // Add "Product2" first
    t = addColumn(t, { id: 'dup1', name: 'Product2', position: 3 });
    // Now add "Product" — "Product" exists and "Product2" exists, so it becomes "Product22"
    const updated = addColumn(t, { id: 'dup2', name: 'Product', position: 0 });
    expect(updated.columns[0].name).toBe('Product22');
  });

  it('renameColumn throws when new name already exists (case-insensitive)', () => {
    const t = makeTable(); // has "Product", "Price", "Qty"
    expect(() => renameColumn(t, t.columns[0].id, 'Price')).toThrow(/already exists/);
    expect(() => renameColumn(t, t.columns[0].id, 'price')).toThrow(/already exists/);
    expect(() => renameColumn(t, t.columns[0].id, 'PRICE')).toThrow(/already exists/);
  });

  it('renameColumn allows renaming to same name (own column)', () => {
    const t = makeTable();
    // Renaming "Product" to "Product" should not throw
    const updated = renameColumn(t, t.columns[0].id, 'Product');
    expect(updated.columns[0].name).toBe('Product');
  });

  it('renameColumn returns unchanged table for unknown column id', () => {
    const t = makeTable();
    const updated = renameColumn(t, 'nonexistent-id', 'NewName');
    expect(updated).toBe(t);
  });
});

// =============================================================================
// toggleTotalsRow
// =============================================================================

describe('toggleTotalsRow', () => {
  it('turning on expands endRow by 1', () => {
    const t = makeTable(); // hasTotalsRow=false, endRow=5
    const toggled = toggleTotalsRow(t);
    expect(toggled.hasTotalsRow).toBe(true);
    expect(toggled.range.endRow).toBe(6);
  });

  it('turning off contracts endRow by 1', () => {
    const t = makeTableWithTotals(); // hasTotalsRow=true, endRow=5
    const toggled = toggleTotalsRow(t);
    expect(toggled.hasTotalsRow).toBe(false);
    expect(toggled.range.endRow).toBe(4);
  });

  it('roundtrip preserves original range', () => {
    const t = makeTable();
    const on = toggleTotalsRow(t);
    const off = toggleTotalsRow(on);
    expect(off.range.endRow).toBe(t.range.endRow);
    expect(off.hasTotalsRow).toBe(false);
  });

  it('does not mutate original table', () => {
    const t = makeTable();
    toggleTotalsRow(t);
    expect(t.hasTotalsRow).toBe(false);
    expect(t.range.endRow).toBe(5);
  });
});

// =============================================================================
// addColumn — position clamping
// =============================================================================

describe('addColumn position clamping', () => {
  it('negative position clamps to 0', () => {
    const t = makeTable();
    const updated = addColumn(t, { id: 'neg', name: 'First', position: -5 });
    expect(updated.columns[0].name).toBe('First');
  });

  it('position beyond length clamps to end', () => {
    const t = makeTable(); // 3 columns
    const updated = addColumn(t, { id: 'far', name: 'Last', position: 999 });
    expect(updated.columns[3].name).toBe('Last');
  });
});

// =============================================================================
// setTotalsFunction / renameColumn with unknown column ID
// =============================================================================

describe('operations with unknown column id', () => {
  it('setTotalsFunction with unknown column id returns table with unchanged columns', () => {
    const t = makeTable();
    const updated = setTotalsFunction(t, 'nonexistent-id', 'sum');
    // All columns should remain unchanged
    for (let i = 0; i < t.columns.length; i++) {
      expect(updated.columns[i].totalsFunction).toBe(t.columns[i].totalsFunction);
    }
  });

  it('renameColumn with unknown column id returns unchanged table', () => {
    const t = makeTable();
    const updated = renameColumn(t, 'nonexistent-id', 'NewName');
    expect(updated).toBe(t);
  });
});
