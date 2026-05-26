/**
 * App Kernel API Tests
 *
 * Comprehensive tests for the App Kernel API.
 * The App Kernel API provides apps with a stable interface to interact
 * with spreadsheet data as tables/records.
 *
 * Test coverage:
 * - Tables API: CRUD operations for tables
 * - Columns API: CRUD operations for columns
 * - Records API: CRUD operations for records, filtering, sorting, pagination
 * - Dual access patterns: Access by column name and column ID
 * - Batch operations: Multiple operations as single undo step
 * - Events API: Subscribe to data changes
 *
 * @see kernel/src/app-api/app-kernel-api.ts - Implementation
 * @see contracts/src/apps/api.ts - API interface
 */

import { jest } from '@jest/globals';

import type { Workbook } from '@mog-sdk/contracts/api';
import type { AppColumnId, AppTableId, RecordChangeEvent, RecordId } from '@mog-sdk/contracts/apps';
import { sheetId as makeSheetId, type CellRange, type SheetId } from '@mog-sdk/contracts/core';
import type { TableConfig, TableColumn } from '@mog-sdk/contracts/tables';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type { MapLike } from '@mog/spreadsheet-testing/fixtures';
import { createTestWorkbook } from '@mog/spreadsheet-testing/fixtures';
import type { DocumentContext } from '../../../context/types';

// =============================================================================
// STATEFUL TABLE + CELL STORE
// =============================================================================

/** In-memory cell store: sheetId -> row -> col -> value */
type CellStore = Map<string, Map<number, Map<number, unknown>>>;

function getCellValue(store: CellStore, sheetId: string, row: number, col: number): unknown {
  return store.get(sheetId)?.get(row)?.get(col) ?? null;
}

function setCellValue(
  store: CellStore,
  sheetId: string,
  row: number,
  col: number,
  value: unknown,
): void {
  if (!store.has(sheetId)) store.set(sheetId, new Map());
  const sheetMap = store.get(sheetId)!;
  if (!sheetMap.has(row)) sheetMap.set(row, new Map());
  sheetMap.get(row)!.set(col, value);
}

function deleteCellRow(store: CellStore, sheetId: string, row: number): void {
  const sheetMap = store.get(sheetId);
  if (!sheetMap) return;
  sheetMap.delete(row);
  // Shift rows above down by 1
  const allRows = Array.from(sheetMap.keys())
    .filter((r) => r > row)
    .sort((a, b) => a - b);
  for (const r of allRows) {
    const rowData = sheetMap.get(r)!;
    sheetMap.delete(r);
    sheetMap.set(r - 1, rowData);
  }
}

/** In-memory table store */
const _tableStore = new Map<string, TableConfig>();
const _cellStore: CellStore = new Map();
let _defaultSheetId: SheetId = makeSheetId('');

function resetStores(): void {
  _tableStore.clear();
  _cellStore.clear();
}

// =============================================================================
// MOCK TablesCore
// =============================================================================

// We mock TablesCore so that createTable/getTable/updateTable/deleteTable/etc.
// operate on our in-memory store, avoiding the need for stateful computeBridge mocks.
jest.unstable_mockModule('../../../domain/tables/core', () => {
  let idCounter = 0;

  return {
    createTable: jest.fn(async (_ctx: any, sheetId: SheetId, range: CellRange, options?: any) => {
      idCounter++;
      const name = options?.name ?? `Table${idCounter}`;
      const colCount = range.endCol - range.startCol + 1;
      const columns: TableColumn[] = [];
      for (let i = 0; i < colCount; i++) {
        columns.push({
          id: `col-${idCounter}-${i}`,
          name: `Column${i + 1}`,
          index: i,
        });
      }
      const now = Date.now();
      const id = `table-${idCounter}`;
      const config: TableConfig = {
        id,
        name,
        sheetId,
        range,
        hasHeaderRow: options?.hasHeaderRow ?? true,
        hasTotalRow: false,
        columns,
        style: {
          preset: 'medium2' as any,
          showBandedRows: true,
          showBandedColumns: false,
          showFirstColumnHighlight: false,
          showLastColumnHighlight: false,
        },
        autoExpand: true,
        showFilterButtons: true,
        createdAt: now,
        updatedAt: now,
      };
      _tableStore.set(id, config);
      return config;
    }),

    getTable: jest.fn(async (_ctx: any, tableId: string) => {
      return _tableStore.get(tableId) ?? undefined;
    }),

    getTableByName: jest.fn(async (_ctx: any, name: string) => {
      const lowerName = name.toLowerCase();
      for (const t of _tableStore.values()) {
        if (t.name.toLowerCase() === lowerName) return t;
      }
      return undefined;
    }),

    getAllTables: jest.fn(async (_ctx: any) => {
      return Array.from(_tableStore.values());
    }),

    getTablesInSheet: jest.fn(async (_ctx: any, sheetId: SheetId) => {
      return Array.from(_tableStore.values()).filter((t) => t.sheetId === sheetId);
    }),

    updateTable: jest.fn(async (_ctx: any, tableId: string, updates: Partial<TableConfig>) => {
      const existing = _tableStore.get(tableId);
      if (!existing) return;
      // Apply updates
      if (updates.name !== undefined) existing.name = updates.name;
      if (updates.columns !== undefined) (existing as any).columns = updates.columns;
      if (updates.range !== undefined) existing.range = updates.range;
      if (updates.rangeIdentity !== undefined)
        (existing as any).rangeIdentity = updates.rangeIdentity;
      if (updates.style !== undefined) existing.style = updates.style;
      existing.updatedAt = Date.now();
    }),

    deleteTable: jest.fn(async (_ctx: any, tableId: string, _propagateRefErrors?: boolean) => {
      _tableStore.delete(tableId);
      return 0;
    }),

    getDataRange: jest.fn(async (_ctx: any, tableId: string) => {
      const table = _tableStore.get(tableId);
      if (!table) return null;
      const range = table.range;
      if (!range) return null;
      return {
        ...range,
        startRow: table.hasHeaderRow ? range.startRow + 1 : range.startRow,
        endRow: table.hasTotalRow ? range.endRow - 1 : range.endRow,
      };
    }),

    isValidTableName: jest.fn(async () => true),
    generateTableName: jest.fn(async () => 'Table1'),
    hasMergedCellsInRange: jest.fn(() => false),
    isInTable: jest.fn(async () => false),
    getTableAtCell: jest.fn(async () => undefined),
    getHeaderRange: jest.fn(async () => undefined),
    getTotalRange: jest.fn(async () => undefined),
    validateTableResize: jest.fn(async () => ({ valid: true })),
    convertToRange: jest.fn(async () => 0),
  };
});

// Mock range-resolution to just return table.range
jest.unstable_mockModule('../../../domain/tables/range-resolution', () => ({
  resolveTableRange: jest.fn((_ctx: any, table: TableConfig) => table.range ?? null),
  createTableCellIdRange: jest.fn(() => ({ topLeftCellId: '', bottomRightCellId: '' })),
  needsMigration: jest.fn(() => false),
  migrateLegacyTable: jest.fn((_ctx: any, table: TableConfig) => table),
}));

const { createAppKernelAPI } = await import('../app-kernel-api');

// =============================================================================
// TEST UTILITIES
// =============================================================================

function createMockKernelContext(): {
  ctx: IKernelContext;
  eventHandlers: Map<string, Set<(event: unknown) => void>>;
} {
  const { sheets } = createTestWorkbook({ sheetCount: 1 });

  // Collect sheet IDs
  const sheetIds: SheetId[] = [];
  if (sheets.length > 0) {
    const firstSheet = sheets[0];
    const meta = firstSheet.get('meta') as MapLike<unknown>;
    const sheetId = makeSheetId(meta.get('id') as string);
    sheetIds.push(sheetId);
    _defaultSheetId = sheetId;
  }

  const eventHandlers = new Map<string, Set<(event: unknown) => void>>();

  const eventBus = {
    emit: jest.fn((event: { type: string }) => {
      const handlers = eventHandlers.get(event.type);
      if (handlers) {
        handlers.forEach((handler) => handler(event));
      }
    }),
    on: jest.fn((type: string, handler: (event: unknown) => void) => {
      if (!eventHandlers.has(type)) {
        eventHandlers.set(type, new Set());
      }
      eventHandlers.get(type)!.add(handler);
      return () => {
        eventHandlers.get(type)?.delete(handler);
      };
    }),
    off: jest.fn(),
    onMany: jest.fn(),
    onAll: jest.fn(),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };

  const undoManager = {
    undo: jest.fn(),
    redo: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    destroy: jest.fn(),
    stopCapturing: jest.fn(),
  };

  let pendingUndoDescription: string | null = null;

  const ctx = {
    doc: {} as any,
    refs: { doc: {} as any },
    computeBridge: {
      getAllSheetIds: jest.fn(async () => [...sheetIds]),
      getAllTablesInSheet: jest.fn(async () => []),
      getSheetName: jest.fn(async (id: string) => `Sheet ${id}`),
      createTable: jest.fn(async () => undefined),
      renameTable: jest.fn(async () => undefined),
      getTableByName: jest.fn(async () => null),
      getTableAtCell: jest.fn(async () => null),
      setCell: jest.fn(async () => ({ success: true })),
      setCells: jest.fn(async () => ({ success: true })),
      deleteTable: jest.fn(async () => undefined),
      resizeTable: jest.fn(async () => undefined),
      removeTableColumn: jest.fn(async () => undefined),
      addTableColumn: jest.fn(async () => undefined),
      toggleHeaderRow: jest.fn(async () => undefined),
      toggleTotalsRow: jest.fn(async () => undefined),
      toggleBandedRows: jest.fn(async () => undefined),
      toggleBandedCols: jest.fn(async () => undefined),
      setTableStyle: jest.fn(async () => undefined),
      getCell: jest.fn(async () => undefined),
      getCellIdAtPosition: jest.fn(async () => null),
      queryRange: jest.fn(
        async (sid: string, startRow: number, startCol: number, endRow: number, endCol: number) => {
          const cells: Array<{ row: number; col: number; value: unknown }> = [];
          for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
              const val = getCellValue(_cellStore, sid, r, c);
              if (val !== null && val !== undefined) {
                // Return raw primitive values (CellValue = string | number | boolean | CellError | null)
                cells.push({ row: r, col: c, value: val });
              }
            }
          }
          return { cells, merges: [] };
        },
      ),
      getDataBounds: jest.fn(async () => null),
      beginUndoGroup: jest.fn(async () => undefined),
      endUndoGroup: jest.fn(async () => undefined),
      getFiltersInSheet: jest.fn(async () => []),
    },
    eventBus,
    undoManager,
    setPendingUndoDescription(description: string): void {
      pendingUndoDescription = description;
    },
    getPendingUndoDescription(): string | null {
      return pendingUndoDescription;
    },
    clearPendingUndoDescription(): void {
      pendingUndoDescription = null;
    },
  } as unknown as IKernelContext;

  return { ctx, eventHandlers };
}

function createMockWorkbook(): Workbook {
  const createMockWorksheet = (sheetId: string) => ({
    setCell: jest.fn(async (row: number, col: number, value: any) => {
      setCellValue(_cellStore, sheetId, row, col, value);
    }),
    deleteRows: jest.fn(async (row: number, _count: number) => {
      deleteCellRow(_cellStore, sheetId, row);
    }),
    setCells: jest.fn(
      async (
        updates: Array<{ row: number; col: number; value: string | number | boolean | null }>,
      ) => {
        for (const u of updates) {
          setCellValue(_cellStore, sheetId, u.row, u.col, u.value);
        }
        return { cellsWritten: updates.length };
      },
    ),
    structure: {
      deleteRows: jest.fn(async (row: number, _count: number) => {
        deleteCellRow(_cellStore, sheetId, row);
      }),
    },
  });

  const sheetCache = new Map<string, ReturnType<typeof createMockWorksheet>>();

  const mockGetSheet = jest.fn((sheetId: string) => {
    if (!sheetCache.has(sheetId)) {
      sheetCache.set(sheetId, createMockWorksheet(sheetId));
    }
    return sheetCache.get(sheetId)!;
  });

  return { getSheet: mockGetSheet, getSheetById: mockGetSheet } as unknown as Workbook;
}

// =============================================================================
// TABLES API TESTS
// =============================================================================

describe('App Kernel API - Tables', () => {
  let ctx: IKernelContext;
  let api: any;

  beforeEach(() => {
    resetStores();
    const mock = createMockKernelContext();
    ctx = mock.ctx;
    const workbook = createMockWorkbook();
    api = createAppKernelAPI({ ctx: ctx as unknown as DocumentContext, workbook });
  });

  describe('tables.create()', () => {
    it('should create a table with schema', async () => {
      const table = await api.tables.create({
        name: 'Tasks',
        columns: [
          { name: 'Name', type: { kind: 'text' } },
          { name: 'Status', type: { kind: 'text' } },
          { name: 'Priority', type: { kind: 'number' } },
        ],
      });

      expect(table).toBeDefined();
      expect(table.name).toBe('Tasks');
      expect(table.columns).toHaveLength(3);
      expect(table.columns[0].name).toBe('Name');
      expect(table.columns[1].name).toBe('Status');
      expect(table.columns[2].name).toBe('Priority');
    });

    it('should create a table with specified start cell', async () => {
      const table = await api.tables.create(
        {
          name: 'Data',
          columns: [
            { name: 'Col1', type: { kind: 'text' } },
            { name: 'Col2', type: { kind: 'text' } },
          ],
        },
        { startCell: 'B5' },
      );

      expect(table).toBeDefined();
      expect(table.name).toBe('Data');
    });
  });

  describe('tables.get()', () => {
    it('should get table by ID', async () => {
      const created = await api.tables.create({
        name: 'Projects',
        columns: [{ name: 'Title', type: { kind: 'text' } }],
      });

      const table = await api.tables.get(created.id);

      expect(table).toBeDefined();
      expect(table?.id).toBe(created.id);
      expect(table?.name).toBe('Projects');
    });

    it('should return null for non-existent table', async () => {
      const table = await api.tables.get('non-existent-id' as AppTableId);
      expect(table).toBeNull();
    });
  });

  describe('tables.findByName()', () => {
    it('should find table by name', async () => {
      await api.tables.create({
        name: 'Users',
        columns: [{ name: 'Email', type: { kind: 'text' } }],
      });

      const table = await api.tables.findByName('Users');

      expect(table).toBeDefined();
      expect(table?.name).toBe('Users');
    });

    it('should return null if table not found', async () => {
      const table = await api.tables.findByName('NonExistent');
      expect(table).toBeNull();
    });
  });

  describe('tables.list()', () => {
    it('should list all tables', async () => {
      await api.tables.create(
        {
          name: 'Table1',
          columns: [{ name: 'Col', type: { kind: 'text' } }],
        },
        { startCell: 'A1' },
      );
      await api.tables.create(
        {
          name: 'Table2',
          columns: [{ name: 'Col', type: { kind: 'text' } }],
        },
        { startCell: 'C1' },
      );

      const tables = await api.tables.list();

      expect(tables).toHaveLength(2);
      expect(tables.map((t: any) => t.name)).toContain('Table1');
      expect(tables.map((t: any) => t.name)).toContain('Table2');
    });

    it('should return empty array when no tables exist', async () => {
      const tables = await api.tables.list();
      expect(tables).toEqual([]);
    });
  });

  describe('tables.rename()', () => {
    it('should rename a table', async () => {
      const table = await api.tables.create({
        name: 'OldName',
        columns: [{ name: 'Col', type: { kind: 'text' } }],
      });

      await api.tables.rename(table.id, 'NewName');

      const updated = await api.tables.get(table.id);
      expect(updated?.name).toBe('NewName');
    });
  });

  describe('tables.delete()', () => {
    it('should delete a table', async () => {
      const table = await api.tables.create({
        name: 'ToDelete',
        columns: [{ name: 'Col', type: { kind: 'text' } }],
      });

      await api.tables.delete(table.id);

      const deleted = await api.tables.get(table.id);
      expect(deleted).toBeNull();
    });
  });
});

// =============================================================================
// COLUMNS API TESTS
// =============================================================================

describe('App Kernel API - Columns', () => {
  let ctx: IKernelContext;
  let api: any;
  let tableId: AppTableId;

  beforeEach(async () => {
    resetStores();
    const mock = createMockKernelContext();
    ctx = mock.ctx;
    const workbook = createMockWorkbook();
    api = createAppKernelAPI({ ctx: ctx as unknown as DocumentContext, workbook });

    const table = await api.tables.create({
      name: 'TestTable',
      columns: [
        { name: 'Name', type: { kind: 'text' } },
        { name: 'Age', type: { kind: 'number' } },
      ],
    });
    tableId = table.id;
  });

  describe('columns.create()', () => {
    it('should add column to table', async () => {
      const column = await api.columns.create(tableId, {
        name: 'Email',
        type: { kind: 'text' },
      });

      expect(column).toBeDefined();
      expect(column.name).toBe('Email');
      expect(column.type.kind).toBe('text');
    });

    it('should insert column at specific index', async () => {
      const column = await api.columns.create(
        tableId,
        { name: 'Middle', type: { kind: 'text' } },
        { index: 1 },
      );

      expect(column.index).toBe(1);

      const table = await api.tables.get(tableId);
      expect(table?.columns[1].name).toBe('Middle');
    });
  });

  describe('columns.get()', () => {
    it('should get column by ID', async () => {
      const table = await api.tables.get(tableId);
      const columnId = table.columns[0].id;

      const column = await api.columns.get(tableId, columnId);

      expect(column).toBeDefined();
      expect(column?.name).toBe('Name');
    });

    it('should return null for non-existent column', async () => {
      const column = await api.columns.get(tableId, 'non-existent' as AppColumnId);
      expect(column).toBeNull();
    });
  });

  describe('columns.findByName()', () => {
    it('should find column by name', async () => {
      const column = await api.columns.findByName(tableId, 'Name');

      expect(column).toBeDefined();
      expect(column?.name).toBe('Name');
    });

    it('should find column case-insensitively', async () => {
      const column = await api.columns.findByName(tableId, 'NAME');

      expect(column).toBeDefined();
      expect(column?.name).toBe('Name');
    });

    it('should return null if column not found', async () => {
      const column = await api.columns.findByName(tableId, 'NonExistent');
      expect(column).toBeNull();
    });
  });

  describe('columns.list()', () => {
    it('should list all columns in table', async () => {
      const columns = await api.columns.list(tableId);

      expect(columns).toHaveLength(2);
      expect(columns[0].name).toBe('Name');
      expect(columns[1].name).toBe('Age');
    });

    it('should return empty array for non-existent table', async () => {
      const columns = await api.columns.list('non-existent' as AppTableId);
      expect(columns).toEqual([]);
    });
  });

  describe('columns.rename()', () => {
    it('should rename a column', async () => {
      const table = await api.tables.get(tableId);
      const columnId = table.columns[0].id;

      await api.columns.rename(tableId, columnId, 'FullName');

      const column = await api.columns.get(tableId, columnId);
      expect(column?.name).toBe('FullName');
    });
  });

  describe('columns.delete()', () => {
    it('should delete a column', async () => {
      const table = await api.tables.get(tableId);
      const columnId = table.columns[1].id;

      await api.columns.delete(tableId, columnId);

      const columns = await api.columns.list(tableId);
      expect(columns).toHaveLength(1);
      expect(columns[0].name).toBe('Name');
    });
  });
});

// =============================================================================
// RECORDS API TESTS
// =============================================================================

describe('App Kernel API - Records', () => {
  let ctx: IKernelContext;
  let api: any;
  let tableId: AppTableId;

  beforeEach(async () => {
    resetStores();
    const mock = createMockKernelContext();
    ctx = mock.ctx;
    const workbook = createMockWorkbook();
    api = createAppKernelAPI({ ctx: ctx as unknown as DocumentContext, workbook });

    const table = await api.tables.create({
      name: 'Tasks',
      columns: [
        { name: 'Title', type: { kind: 'text' } },
        { name: 'Status', type: { kind: 'text' } },
        { name: 'Priority', type: { kind: 'number' } },
      ],
    });
    tableId = table.id;
  });

  describe('records.create()', () => {
    it('should create a record with values', async () => {
      const record = await api.records.create(tableId, {
        Title: 'Task 1',
        Status: 'Open',
        Priority: 1,
      });

      expect(record).toBeDefined();
      expect(record.values['Title']).toBe('Task 1');
      expect(record.values['Status']).toBe('Open');
      expect(record.values['Priority']).toBe(1);
    });

    it('should create a record with partial values', async () => {
      const record = await api.records.create(tableId, {
        Title: 'Task 2',
      });

      expect(record.values['Title']).toBe('Task 2');
      expect(record.values['Status']).toBeNull();
    });
  });

  describe('records.get()', () => {
    it('should get record by ID', async () => {
      const created = await api.records.create(tableId, {
        Title: 'Task 1',
        Status: 'Open',
      });

      const record = await api.records.get(tableId, created.id);

      expect(record).toBeDefined();
      expect(record?.id).toBe(created.id);
      expect(record?.values['Title']).toBe('Task 1');
    });

    it('should return null for non-existent record', async () => {
      const record = await api.records.get(tableId, '999999' as RecordId);
      expect(record).toBeNull();
    });
  });

  describe('records.list()', () => {
    it('should list records with no options', async () => {
      await api.records.create(tableId, { Title: 'Task 1', Status: 'Open', Priority: 1 });
      await api.records.create(tableId, { Title: 'Task 2', Status: 'Closed', Priority: 2 });
      await api.records.create(tableId, { Title: 'Task 3', Status: 'Open', Priority: 3 });

      const records = await api.records.list(tableId);

      expect(records).toHaveLength(3);
    });

    it('should filter records by field value', async () => {
      await api.records.create(tableId, { Title: 'Task 1', Status: 'Open', Priority: 1 });
      await api.records.create(tableId, { Title: 'Task 2', Status: 'Closed', Priority: 2 });
      await api.records.create(tableId, { Title: 'Task 3', Status: 'Open', Priority: 3 });

      const records = await api.records.list(tableId, {
        filter: {
          conditions: [{ field: 'Status', operator: 'equals', value: 'Open' }],
        },
      });

      expect(records).toHaveLength(2);
      expect(records.every((r: any) => r.values['Status'] === 'Open')).toBe(true);
    });

    it('should filter with contains operator', async () => {
      await api.records.create(tableId, { Title: 'Buy groceries', Status: 'Open' });
      await api.records.create(tableId, { Title: 'Buy tickets', Status: 'Open' });
      await api.records.create(tableId, { Title: 'Sell items', Status: 'Open' });

      const records = await api.records.list(tableId, {
        filter: {
          conditions: [{ field: 'Title', operator: 'contains', value: 'Buy' }],
        },
      });

      expect(records).toHaveLength(2);
      expect(records.every((r: any) => (r.values['Title'] as string).includes('Buy'))).toBe(true);
    });

    it('should filter with isEmpty operator', async () => {
      await api.records.create(tableId, { Title: 'Task 1', Status: 'Open' });
      await api.records.create(tableId, { Title: 'Task 2', Status: null });
      await api.records.create(tableId, { Title: 'Task 3', Status: '' });

      const records = await api.records.list(tableId, {
        filter: {
          conditions: [{ field: 'Status', operator: 'isEmpty' }],
        },
      });

      expect(records).toHaveLength(2);
    });

    it('should sort records ascending', async () => {
      await api.records.create(tableId, { Title: 'C', Priority: 3 });
      await api.records.create(tableId, { Title: 'A', Priority: 1 });
      await api.records.create(tableId, { Title: 'B', Priority: 2 });

      const records = await api.records.list(tableId, {
        sort: [{ field: 'Title', direction: 'asc' }],
      });

      expect(records[0].values['Title']).toBe('A');
      expect(records[1].values['Title']).toBe('B');
      expect(records[2].values['Title']).toBe('C');
    });

    it('should sort records descending', async () => {
      await api.records.create(tableId, { Title: 'C', Priority: 3 });
      await api.records.create(tableId, { Title: 'A', Priority: 1 });
      await api.records.create(tableId, { Title: 'B', Priority: 2 });

      const records = await api.records.list(tableId, {
        sort: [{ field: 'Priority', direction: 'desc' }],
      });

      expect(records[0].values['Priority']).toBe(3);
      expect(records[1].values['Priority']).toBe(2);
      expect(records[2].values['Priority']).toBe(1);
    });

    it('should paginate with limit', async () => {
      for (let i = 0; i < 5; i++) {
        await api.records.create(tableId, { Title: `Task ${i}`, Priority: i });
      }

      const records = await api.records.list(tableId, { limit: 2 });

      expect(records).toHaveLength(2);
    });

    it('should paginate with offset', async () => {
      for (let i = 0; i < 5; i++) {
        await api.records.create(tableId, { Title: `Task ${i}`, Priority: i });
      }

      const records = await api.records.list(tableId, { offset: 3 });

      expect(records).toHaveLength(2);
    });

    it('should paginate with limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await api.records.create(tableId, { Title: `Task ${i}`, Priority: i });
      }

      const records = await api.records.list(tableId, { limit: 2, offset: 1 });

      expect(records).toHaveLength(2);
      expect(records[0].values['Priority']).toBe(1);
      expect(records[1].values['Priority']).toBe(2);
    });

    it('should combine filter, sort, and pagination', async () => {
      await api.records.create(tableId, { Title: 'Task 1', Status: 'Open', Priority: 3 });
      await api.records.create(tableId, { Title: 'Task 2', Status: 'Open', Priority: 1 });
      await api.records.create(tableId, { Title: 'Task 3', Status: 'Closed', Priority: 2 });
      await api.records.create(tableId, { Title: 'Task 4', Status: 'Open', Priority: 2 });

      const records = await api.records.list(tableId, {
        filter: { conditions: [{ field: 'Status', operator: 'equals', value: 'Open' }] },
        sort: [{ field: 'Priority', direction: 'asc' }],
        limit: 2,
      });

      expect(records).toHaveLength(2);
      expect(records[0].values['Priority']).toBe(1);
      expect(records[1].values['Priority']).toBe(2);
    });
  });

  describe('records.update()', () => {
    it('should update record values', async () => {
      const record = await api.records.create(tableId, {
        Title: 'Task 1',
        Status: 'Open',
        Priority: 1,
      });

      const updated = await api.records.update(tableId, record.id, {
        Status: 'Closed',
        Priority: 5,
      });

      expect(updated.values['Title']).toBe('Task 1');
      expect(updated.values['Status']).toBe('Closed');
      expect(updated.values['Priority']).toBe(5);
    });

    it('should update partial record values', async () => {
      const record = await api.records.create(tableId, {
        Title: 'Task 1',
        Status: 'Open',
      });

      const updated = await api.records.update(tableId, record.id, {
        Status: 'In Progress',
      });

      expect(updated.values['Title']).toBe('Task 1');
      expect(updated.values['Status']).toBe('In Progress');
    });
  });

  describe('records.delete()', () => {
    it('should delete a record', async () => {
      const record = await api.records.create(tableId, {
        Title: 'Task 1',
        Status: 'Open',
      });

      await api.records.delete(tableId, record.id);

      const deleted = await api.records.get(tableId, record.id);
      expect(deleted).toBeNull();
    });

    it('should verify row is actually removed', async () => {
      await api.records.create(tableId, { Title: 'Task 1' });
      const record2 = await api.records.create(tableId, { Title: 'Task 2' });
      await api.records.create(tableId, { Title: 'Task 3' });

      const beforeCount = (await api.records.list(tableId)).length;
      expect(beforeCount).toBe(3);

      await api.records.delete(tableId, record2.id);

      const afterCount = (await api.records.list(tableId)).length;
      expect(afterCount).toBe(2);

      const remaining = await api.records.list(tableId);
      expect(remaining.map((r: any) => r.values['Title'])).not.toContain('Task 2');
    });
  });

  describe('records.createBatch()', () => {
    it('should batch create multiple records', async () => {
      const records = await api.records.createBatch(tableId, [
        { Title: 'Task 1', Status: 'Open', Priority: 1 },
        { Title: 'Task 2', Status: 'Closed', Priority: 2 },
        { Title: 'Task 3', Status: 'Open', Priority: 3 },
      ]);

      expect(records).toHaveLength(3);
      expect(records[0].values['Title']).toBe('Task 1');
      expect(records[1].values['Title']).toBe('Task 2');
      expect(records[2].values['Title']).toBe('Task 3');
    });
  });

  describe('records.updateBatch()', () => {
    it('should batch update multiple records', async () => {
      const r1 = await api.records.create(tableId, { Title: 'Task 1', Status: 'Open' });
      const r2 = await api.records.create(tableId, { Title: 'Task 2', Status: 'Open' });

      const updated = await api.records.updateBatch(tableId, [
        { id: r1.id, values: { Status: 'Closed' } },
        { id: r2.id, values: { Status: 'In Progress' } },
      ]);

      expect(updated).toHaveLength(2);
      expect(updated[0].values['Status']).toBe('Closed');
      expect(updated[1].values['Status']).toBe('In Progress');
    });
  });

  describe('records.deleteBatch()', () => {
    it('should batch delete multiple records', async () => {
      const r1 = await api.records.create(tableId, { Title: 'Task 1' });
      const _r2 = await api.records.create(tableId, { Title: 'Task 2' });
      const r3 = await api.records.create(tableId, { Title: 'Task 3' });

      await api.records.deleteBatch(tableId, [r1.id, r3.id]);

      const remaining = await api.records.list(tableId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].values['Title']).toBe('Task 2');
    });
  });
});

// =============================================================================
// DUAL ACCESS PATTERN TESTS
// =============================================================================

describe('App Kernel API - Dual Access Patterns', () => {
  let ctx: IKernelContext;
  let api: any;
  let tableId: AppTableId;

  beforeEach(async () => {
    resetStores();
    const mock = createMockKernelContext();
    ctx = mock.ctx;
    const workbook = createMockWorkbook();
    api = createAppKernelAPI({ ctx: ctx as unknown as DocumentContext, workbook });

    const table = await api.tables.create({
      name: 'TestTable',
      columns: [
        { name: 'Name', type: { kind: 'text' } },
        { name: 'Value', type: { kind: 'number' } },
      ],
    });
    tableId = table.id;
  });

  it('should access record values by column name', async () => {
    const record = await api.records.create(tableId, {
      Name: 'Test',
      Value: 42,
    });

    expect(record.values['Name']).toBe('Test');
    expect(record.values['Value']).toBe(42);
  });

  it('should access record values by column ID', async () => {
    const table = await api.tables.get(tableId);
    const nameColumnId = table.columns[0].id;
    const valueColumnId = table.columns[1].id;

    const record = await api.records.create(tableId, {
      Name: 'Test',
      Value: 42,
    });

    expect(record.valuesByColumnId[nameColumnId]).toBe('Test');
    expect(record.valuesByColumnId[valueColumnId]).toBe(42);
  });

  it('should return same data for both access patterns', async () => {
    const table = await api.tables.get(tableId);
    const nameColumnId = table.columns[0].id;

    const record = await api.records.create(tableId, {
      Name: 'Test Value',
    });

    expect(record.values['Name']).toBe(record.valuesByColumnId[nameColumnId]);
  });

  it('should work with column ID in filter', async () => {
    const table = await api.tables.get(tableId);
    const nameColumnId = table.columns[0].id;

    await api.records.create(tableId, { Name: 'Alice', Value: 1 });
    await api.records.create(tableId, { Name: 'Bob', Value: 2 });

    const records = await api.records.list(tableId, {
      filter: {
        conditions: [{ field: nameColumnId, operator: 'equals', value: 'Alice' }],
      },
    });

    expect(records).toHaveLength(1);
    expect(records[0].values['Name']).toBe('Alice');
  });

  it('should work with column ID in sort', async () => {
    const table = await api.tables.get(tableId);
    const valueColumnId = table.columns[1].id;

    await api.records.create(tableId, { Name: 'C', Value: 3 });
    await api.records.create(tableId, { Name: 'A', Value: 1 });
    await api.records.create(tableId, { Name: 'B', Value: 2 });

    const records = await api.records.list(tableId, {
      sort: [{ field: valueColumnId, direction: 'asc' }],
    });

    expect(records[0].values['Value']).toBe(1);
    expect(records[1].values['Value']).toBe(2);
    expect(records[2].values['Value']).toBe(3);
  });
});

// =============================================================================
// BATCH OPERATION TESTS
// =============================================================================

describe('App Kernel API - Batch Operations', () => {
  let ctx: IKernelContext;
  let api: any;
  let tableId: AppTableId;

  beforeEach(async () => {
    resetStores();
    const mock = createMockKernelContext();
    ctx = mock.ctx;
    const workbook = createMockWorkbook();
    api = createAppKernelAPI({ ctx: ctx as unknown as DocumentContext, workbook });

    const table = await api.tables.create({
      name: 'TestTable',
      columns: [
        { name: 'Name', type: { kind: 'text' } },
        { name: 'Value', type: { kind: 'number' } },
      ],
    });
    tableId = table.id;
  });

  it('should execute multiple operations as single undo step', async () => {
    // batch() is synchronous — it wraps calls in an undo group.
    // Since the inner API calls are async, we serialize them with await inside
    // an async batch callback. batch() returns the Promise from fn().
    const resultPromise = api.undoGroup(async () => {
      await api.records.create(tableId, { Name: 'Task 1', Value: 1 });
      await api.records.create(tableId, { Name: 'Task 2', Value: 2 });
      return 'done';
    });

    const result = await resultPromise;
    expect(result).toBe('done');

    const records = await api.records.list(tableId);
    expect(records).toHaveLength(2);
  });

  it('should set undo description', async () => {
    const batchPromise = api.undoGroup(async () => {
      await api.records.create(tableId, { Name: 'Task 1' });
      await api.records.create(tableId, { Name: 'Task 2' });
    }, 'Create multiple tasks');

    await batchPromise;

    // Description is consumed by undo manager
    const records = await api.records.list(tableId);
    expect(records).toHaveLength(2);
  });

  it('should return value from batch function', async () => {
    // batch returns whatever fn() returns; since fn returns a Promise, we await it.
    const newRecordPromise = api.undoGroup(() => {
      return api.records.create(tableId, { Name: 'Batched Task', Value: 99 });
    });

    const newRecord = await newRecordPromise;

    expect(newRecord.values['Name']).toBe('Batched Task');
    expect(newRecord.values['Value']).toBe(99);
  });
});

// =============================================================================
// EVENTS API TESTS
// =============================================================================

describe('App Kernel API - Events', () => {
  let ctx: IKernelContext;
  let api: any;
  let tableId: AppTableId;

  beforeEach(async () => {
    resetStores();
    const mock = createMockKernelContext();
    ctx = mock.ctx;
    const workbook = createMockWorkbook();
    api = createAppKernelAPI({ ctx: ctx as unknown as DocumentContext, workbook });

    const table = await api.tables.create({
      name: 'TestTable',
      columns: [
        { name: 'Name', type: { kind: 'text' } },
        { name: 'Value', type: { kind: 'number' } },
      ],
    });
    tableId = table.id;
  });

  describe('events.onRecordChange()', () => {
    it('should subscribe to record changes', async () => {
      const events: RecordChangeEvent[] = [];
      const table = await api.tables.get(tableId);

      api.events.onRecordChange(tableId, (event: any) => {
        events.push(event);
      });

      const record = await api.records.create(tableId, { Name: 'Test' });
      const rowIndex = parseInt(record.id as unknown as string, 10);

      // Emit cell:changed event
      ctx.eventBus.emit({
        type: 'cell:changed',
        sheetId: table.sheetId,
        row: rowIndex,
        col: 0,
        oldValue: 'Test',
        newValue: 'Updated',
        source: 'user',
        timestamp: Date.now(),
      });

      // Wait for async event processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].type).toBe('updated');
      expect(events[0].tableId).toBe(tableId);
    });

    it('should unsubscribe from record changes', async () => {
      const events: RecordChangeEvent[] = [];

      const unsubscribe = api.events.onRecordChange(tableId, (event: any) => {
        events.push(event);
      });

      unsubscribe();

      const record = await api.records.create(tableId, { Name: 'Test' });
      const table = await api.tables.get(tableId);
      const rowIndex = parseInt(record.id as unknown as string, 10);

      ctx.eventBus.emit({
        type: 'cell:changed',
        sheetId: table.sheetId,
        row: rowIndex,
        col: 0,
        oldValue: 'Test',
        newValue: 'Updated',
        source: 'user',
        timestamp: Date.now(),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events).toHaveLength(0);
    });
  });

  describe('events.onSchemaChange()', () => {
    it('should subscribe to schema changes', async () => {
      const events: any[] = [];
      const table = await api.tables.get(tableId);

      api.events.onSchemaChange(tableId, (event: any) => {
        events.push(event);
      });

      // Trigger a table:created event
      ctx.eventBus.emit({
        type: 'table:created',
        sheetId: table.sheetId,
        tableId: table.id as unknown as string,
        config: {
          id: table.id as unknown as string,
          name: table.name,
          sheetId: table.sheetId,
          range: { startRow: 0, startCol: 0, endRow: 10, endCol: 2 },
          hasHeaderRow: true,
          hasTotalRow: false,
          columns: [],
          style: { preset: 'medium2' },
          autoExpand: true,
          showFilterButtons: true,
        },
        source: 'user',
        timestamp: Date.now(),
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('columnAdded');
      expect(events[0].tableId).toBe(tableId);
    });

    it('should unsubscribe from schema changes', async () => {
      const events: any[] = [];

      const unsubscribe = api.events.onSchemaChange(tableId, (event: any) => {
        events.push(event);
      });

      unsubscribe();

      const table = await api.tables.get(tableId);
      ctx.eventBus.emit({
        type: 'table:created',
        sheetId: table.sheetId,
        tableId: table.id as unknown as string,
        config: {
          id: table.id as unknown as string,
          name: table.name,
          sheetId: table.sheetId,
          range: { startRow: 0, startCol: 0, endRow: 10, endCol: 2 },
          hasHeaderRow: true,
          hasTotalRow: false,
          columns: [],
          style: { preset: 'medium2' },
          autoExpand: true,
          showFilterButtons: true,
        },
        source: 'user',
        timestamp: Date.now(),
      });

      expect(events).toHaveLength(0);
    });
  });

  describe('events.onRecordFieldChange()', () => {
    it('should subscribe to specific record field changes', async () => {
      const fieldChanges: Array<{ fieldId: any; value: any }> = [];

      const record = await api.records.create(tableId, { Name: 'Test', Value: 1 });
      const table = await api.tables.get(tableId);
      const nameColumnId = table.columns[0].id;

      api.events.onRecordFieldChange(tableId, record.id, (fieldId: any, value: any) => {
        fieldChanges.push({ fieldId, value });
      });

      const rowIndex = parseInt(record.id as unknown as string, 10);
      ctx.eventBus.emit({
        type: 'cell:changed',
        sheetId: table.sheetId,
        row: rowIndex,
        col: 0,
        oldValue: 'Test',
        newValue: 'Updated',
        source: 'user',
        timestamp: Date.now(),
      });

      // Wait for async event processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fieldChanges.length).toBeGreaterThanOrEqual(1);
      expect(fieldChanges[0].fieldId).toBe(nameColumnId);
      expect(fieldChanges[0].value).toBe('Updated');
    });
  });
});
