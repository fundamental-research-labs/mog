/**
 * Table Bridge Tests
 *
 * Unit tests for the TableBridge which integrates the stateless @mog/table-engine
 * with Store/EventBus via type conversion, bitmap caching, and event subscriptions.
 *
 * Tests cover:
 * - convertTableConfig type mapping
 * - convertFilterCriteria for all 3 supported types (value, condition, top10)
 * - convertFilterCriteria returns null for color type
 * - Per-column bitmap caching (evaluate, cache, invalidate)
 * - Bitmap recomposition via composeBitmaps
 * - Style preset mapping (light1 -> TableStyleLight1, etc.)
 *
 * @see table-bridge.ts - Implementation
 */

import { jest } from '@jest/globals';

import { type CellRange, type CellValue, type SheetId, sheetId } from '@mog-sdk/contracts/core';
import type { IEventBus } from '@mog-sdk/contracts/events';
import type { ColumnFilterCriteria } from '@mog-sdk/contracts/filter';
import type { TableColumn as ContractsTableColumn, TableConfig } from '@mog-sdk/contracts/tables';
import { initTableWasm, type FilterCriteria } from '@mog/table-engine';

import type { DocumentContext } from '../../context/types';
import { TableBridge, convertFilterCriteria, convertTableConfig } from '../table-bridge';

initTableWasm({
  table_evaluate_column_filter: (criteria: any, columnData: readonly any[]) => {
    if (criteria.type === 'values') {
      const included = new Set(criteria.included.map(String));
      return columnData.map((value: any) => (included.has(String(value)) ? 1 : 0));
    }
    return new Array(columnData.length).fill(1);
  },
  table_compose_bitmaps: (bitmaps: readonly number[][]) => {
    if (bitmaps.length === 0) return [];
    const len = bitmaps[0].length;
    const result = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      result[i] = bitmaps.every((bitmap) => bitmap[i] === 1) ? 1 : 0;
    }
    return result;
  },
  table_create_row_visibility: (bitmap: readonly number[]) => {
    let visibleCount = 0;
    let firstVisibleRow = -1;
    let lastVisibleRow = -1;
    for (let i = 0; i < bitmap.length; i++) {
      if (bitmap[i] === 1) {
        visibleCount++;
        if (firstVisibleRow === -1) firstVisibleRow = i;
        lastVisibleRow = i;
      }
    }
    return {
      bitmap,
      visibleCount,
      totalCount: bitmap.length,
      firstVisibleRow,
      lastVisibleRow,
    };
  },
} as any);

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create a minimal mock EventBus for testing.
 */
function createMockEventBus(): IEventBus & { handlers: Map<string, Function[]> } {
  const handlers = new Map<string, Function[]>();
  return {
    handlers,
    on: jest.fn((type: string, handler: Function) => {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type)!.push(handler);
      return () => {
        const arr = handlers.get(type);
        if (arr) {
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        }
      };
    }),
    onMany: jest.fn((_types: string[], _handler: Function) => () => {}),
    onAll: jest.fn((_handler: Function) => () => {}),
    emit: jest.fn((event: any) => {
      const arr = handlers.get(event.type);
      if (arr) {
        for (const h of arr) h(event);
      }
    }),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

/**
 * Create a minimal mock DocumentContext for testing.
 */
function createMockCtx(): {
  ctx: DocumentContext;
  eventBus: ReturnType<typeof createMockEventBus>;
} {
  const eventBus = createMockEventBus();
  const ctx = {
    eventBus,
  } as unknown as DocumentContext;
  return { ctx, eventBus };
}

/**
 * Create a mock TableConfig for testing.
 */
function createMockTableConfig(overrides?: Partial<TableConfig>): TableConfig {
  return {
    id: 'table-1',
    name: 'SalesData',
    sheetId: sheetId('sheet-1'),
    range: { startRow: 0, startCol: 0, endRow: 10, endCol: 3 },
    hasHeaderRow: true,
    hasTotalRow: false,
    columns: [
      { id: 'col-a', name: 'Name', index: 0 },
      { id: 'col-b', name: 'Amount', index: 1 },
      { id: 'col-c', name: 'Category', index: 2 },
      {
        id: 'col-d',
        name: 'Total',
        index: 3,
        totalFunction: 'sum',
        totalFormula: '=SUBTOTAL(109,[Amount])',
      },
    ] as ContractsTableColumn[],
    style: {
      preset: 'medium2',
      showBandedRows: true,
      showBandedColumns: false,
      showFirstColumnHighlight: false,
      showLastColumnHighlight: false,
    },
    autoExpand: true,
    showFilterButtons: true,
    ...overrides,
  };
}

/**
 * Create a mock CellRange.
 */
function createRange(
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): CellRange {
  return { startRow, startCol, endRow, endCol };
}

// =============================================================================
// convertTableConfig Tests
// =============================================================================

describe('convertTableConfig', () => {
  it('should map basic table properties', () => {
    const config = createMockTableConfig();
    const range = createRange(0, 0, 10, 3);
    const table = convertTableConfig(config, range);

    expect(table.id).toBe('table-1');
    expect(table.name).toBe('SalesData');
    expect(table.sheetId).toBe('sheet-1');
    expect(table.range).toEqual(range);
    expect(table.hasHeaderRow).toBe(true);
    expect(table.showFilterButtons).toBe(true);
  });

  it('should map hasTotalRow to hasTotalsRow', () => {
    const config = createMockTableConfig({ hasTotalRow: true });
    const table = convertTableConfig(config, createRange(0, 0, 10, 3));
    expect(table.hasTotalsRow).toBe(true);

    const config2 = createMockTableConfig({ hasTotalRow: false });
    const table2 = convertTableConfig(config2, createRange(0, 0, 10, 3));
    expect(table2.hasTotalsRow).toBe(false);
  });

  it('should map style banding options with defaults', () => {
    const config = createMockTableConfig({
      style: {
        preset: 'light1',
        showBandedRows: false,
        showBandedColumns: true,
        showFirstColumnHighlight: true,
        showLastColumnHighlight: true,
      },
    });
    const table = convertTableConfig(config, createRange(0, 0, 10, 3));

    expect(table.bandedRows).toBe(false);
    expect(table.bandedColumns).toBe(true);
    expect(table.emphasizeFirstColumn).toBe(true);
    expect(table.emphasizeLastColumn).toBe(true);
  });

  it('should use defaults for missing style options', () => {
    const config = createMockTableConfig({
      style: { preset: 'light1' },
    });
    const table = convertTableConfig(config, createRange(0, 0, 10, 3));

    expect(table.bandedRows).toBe(true); // default true
    expect(table.bandedColumns).toBe(false); // default false
    expect(table.emphasizeFirstColumn).toBe(false); // default false
    expect(table.emphasizeLastColumn).toBe(false); // default false
  });

  it('should map column totalFunction: none/undefined to null', () => {
    const config = createMockTableConfig({
      columns: [
        { id: 'col-a', name: 'Name', index: 0 } as ContractsTableColumn,
        { id: 'col-b', name: 'Amount', index: 1, totalFunction: 'none' } as ContractsTableColumn,
        { id: 'col-c', name: 'Total', index: 2, totalFunction: 'sum' } as ContractsTableColumn,
      ],
    });
    const table = convertTableConfig(config, createRange(0, 0, 10, 2));

    expect(table.columns[0].totalsFunction).toBeNull(); // undefined -> null
    expect(table.columns[1].totalsFunction).toBeNull(); // 'none' -> null
    expect(table.columns[2].totalsFunction).toBe('sum'); // 'sum' stays 'sum'
  });

  it('should map column totalFormula to totalsLabel', () => {
    const config = createMockTableConfig({
      columns: [
        { id: 'col-a', name: 'Name', index: 0 } as ContractsTableColumn,
        {
          id: 'col-b',
          name: 'Total',
          index: 1,
          totalFormula: '=SUBTOTAL(109,[Amount])',
        } as ContractsTableColumn,
      ],
    });
    const table = convertTableConfig(config, createRange(0, 0, 10, 1));

    expect(table.columns[0].totalsLabel).toBeNull();
    expect(table.columns[1].totalsLabel).toBe('=SUBTOTAL(109,[Amount])');
  });
});

// =============================================================================
// Style Preset Mapping Tests
// =============================================================================

describe('style preset mapping', () => {
  it('should map light presets correctly', () => {
    const config = createMockTableConfig({ style: { preset: 'light1' } });
    const table = convertTableConfig(config, createRange(0, 0, 10, 3));
    expect(table.style).toBe('TableStyleLight1');
  });

  it('should map medium presets correctly', () => {
    const config = createMockTableConfig({ style: { preset: 'medium2' } });
    const table = convertTableConfig(config, createRange(0, 0, 10, 3));
    expect(table.style).toBe('TableStyleMedium2');
  });

  it('should map dark presets correctly', () => {
    const config = createMockTableConfig({ style: { preset: 'dark5' } });
    const table = convertTableConfig(config, createRange(0, 0, 10, 3));
    expect(table.style).toBe('TableStyleDark5');
  });

  it('should map none to default TableStyleMedium2', () => {
    const config = createMockTableConfig({ style: { preset: 'none' } });
    const table = convertTableConfig(config, createRange(0, 0, 10, 3));
    expect(table.style).toBe('TableStyleMedium2');
  });

  it('should use default for undefined preset', () => {
    const config = createMockTableConfig({ style: {} });
    const table = convertTableConfig(config, createRange(0, 0, 10, 3));
    expect(table.style).toBe('TableStyleMedium2');
  });

  it('should map double-digit presets', () => {
    const config11 = createMockTableConfig({ style: { preset: 'light11' } });
    expect(convertTableConfig(config11, createRange(0, 0, 10, 3)).style).toBe('TableStyleLight11');

    const config28 = createMockTableConfig({ style: { preset: 'medium28' } });
    expect(convertTableConfig(config28, createRange(0, 0, 10, 3)).style).toBe('TableStyleMedium28');

    const config11d = createMockTableConfig({ style: { preset: 'dark11' } });
    expect(convertTableConfig(config11d, createRange(0, 0, 10, 3)).style).toBe('TableStyleDark11');
  });
});

// =============================================================================
// convertFilterCriteria Tests
// =============================================================================

describe('convertFilterCriteria', () => {
  it('should convert value filter', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: ['Apple', 'Banana', 'Cherry'],
    };
    const result = convertFilterCriteria(criteria);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('values');
    const valueFilter = result as { type: 'values'; included: CellValue[]; includeBlanks: boolean };
    expect(valueFilter.included).toEqual(['Apple', 'Banana', 'Cherry']);
    expect(valueFilter.includeBlanks).toBe(false);
  });

  it('should detect blanks in value filter', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: ['Apple', null, ''],
    };
    const result = convertFilterCriteria(criteria);

    expect(result).not.toBeNull();
    const valueFilter = result as { type: 'values'; included: CellValue[]; includeBlanks: boolean };
    expect(valueFilter.includeBlanks).toBe(true);
  });

  it('should preserve explicit includeBlanks false even when legacy blank values are present', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: ['Apple', null, ''],
      includeBlanks: false,
    };
    const result = convertFilterCriteria(criteria);

    expect(result).not.toBeNull();
    const valueFilter = result as { type: 'values'; included: CellValue[]; includeBlanks: boolean };
    expect(valueFilter.included).toEqual(['Apple']);
    expect(valueFilter.includeBlanks).toBe(false);
  });

  it('should handle empty values in value filter', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
    };
    const result = convertFilterCriteria(criteria);

    expect(result).not.toBeNull();
    const valueFilter = result as { type: 'values'; included: CellValue[]; includeBlanks: boolean };
    expect(valueFilter.included).toEqual([]);
    expect(valueFilter.includeBlanks).toBe(false);
  });

  it('should convert condition filter', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [
        { operator: 'greaterThan', value: 100 },
        { operator: 'lessThan', value: 500 },
      ],
      conditionLogic: 'and',
    };
    const result = convertFilterCriteria(criteria);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('condition');
    const condFilter = result as { type: 'condition'; conditions: any[]; logic: string };
    expect(condFilter.conditions).toHaveLength(2);
    expect(condFilter.conditions[0].operator).toBe('greaterThan');
    expect(condFilter.conditions[0].value).toBe(100);
    expect(condFilter.conditions[1].operator).toBe('lessThan');
    expect(condFilter.conditions[1].value).toBe(500);
    expect(condFilter.logic).toBe('and');
  });

  it('should convert condition filter with or logic', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'equals', value: 'Active' }],
      conditionLogic: 'or',
    };
    const result = convertFilterCriteria(criteria);

    expect(result).not.toBeNull();
    const condFilter = result as { type: 'condition'; logic: string };
    expect(condFilter.logic).toBe('or');
  });

  it('should default conditionLogic to and', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'contains', value: 'test' }],
    };
    const result = convertFilterCriteria(criteria);

    expect(result).not.toBeNull();
    const condFilter = result as { type: 'condition'; logic: string };
    expect(condFilter.logic).toBe('and');
  });

  it('should map startsWith to beginsWith', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'startsWith' as any, value: 'A' }],
    };
    const result = convertFilterCriteria(criteria);

    expect(result).not.toBeNull();
    const condFilter = result as unknown as { type: 'condition'; conditions: any[] };
    expect(condFilter.conditions[0].operator).toBe('beginsWith');
  });

  it('should skip unsupported operators in condition filter', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'isBlank' as any }, { operator: 'greaterThan', value: 50 }],
    };
    const result = convertFilterCriteria(criteria);

    expect(result).not.toBeNull();
    const condFilter = result as unknown as { type: 'condition'; conditions: any[] };
    // isBlank is now a supported operator, so both conditions survive
    expect(condFilter.conditions).toHaveLength(2);
    expect(condFilter.conditions[0].operator).toBe('isBlank');
    expect(condFilter.conditions[1].operator).toBe('greaterThan');
  });

  it('should convert isBlank and skip aboveAverage when mixed with other conditions', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'isBlank' as any }, { operator: 'aboveAverage' as any }],
    };
    const result = convertFilterCriteria(criteria);
    // isBlank is now supported; aboveAverage is only converted to DynamicFilter
    // when it's the sole condition, otherwise it's skipped
    expect(result).not.toBeNull();
    const condFilter = result as unknown as { type: 'condition'; conditions: any[] };
    expect(condFilter.conditions).toHaveLength(1);
    expect(condFilter.conditions[0].operator).toBe('isBlank');
  });

  it('should convert top10 filter', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'top10',
      topBottom: {
        type: 'top',
        count: 5,
        by: 'items',
      },
    };
    const result = convertFilterCriteria(criteria);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('topBottom');
    const topFilter = result as { type: 'topBottom'; direction: string; count: number; by: string };
    expect(topFilter.direction).toBe('top');
    expect(topFilter.count).toBe(5);
    expect(topFilter.by).toBe('items');
  });

  it('should convert top10 filter with bottom/percent', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'top10',
      topBottom: {
        type: 'bottom',
        count: 25,
        by: 'percent',
      },
    };
    const result = convertFilterCriteria(criteria);

    expect(result).not.toBeNull();
    const topFilter = result as { type: 'topBottom'; direction: string; count: number; by: string };
    expect(topFilter.direction).toBe('bottom');
    expect(topFilter.count).toBe(25);
    expect(topFilter.by).toBe('percent');
  });

  it('should use defaults for missing top10 properties', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'top10',
    };
    const result = convertFilterCriteria(criteria);

    expect(result).not.toBeNull();
    const topFilter = result as { type: 'topBottom'; direction: string; count: number; by: string };
    expect(topFilter.direction).toBe('top');
    expect(topFilter.count).toBe(10);
    expect(topFilter.by).toBe('items');
  });

  it('should return null for color filter', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'color',
      colorFilter: {
        type: 'fill',
        color: '#ff0000',
      },
    };
    const result = convertFilterCriteria(criteria);
    expect(result).toBeNull();
  });
});

// =============================================================================
// TableBridge Bitmap Caching Tests
// =============================================================================

describe('TableBridge bitmap caching', () => {
  let bridge: TableBridge;
  let mockCtx: ReturnType<typeof createMockCtx>;
  const getCellValue = jest.fn<CellValue | undefined, [SheetId, number, number]>();

  beforeEach(() => {
    mockCtx = createMockCtx();
    getCellValue.mockReset();
    bridge = new TableBridge({
      ctx: mockCtx.ctx,
      getCellValue,
    });
  });

  afterEach(() => {
    bridge.destroy();
  });

  it('should evaluate and cache a column bitmap', () => {
    const criteria: FilterCriteria = {
      type: 'values',
      included: ['Apple', 'Cherry'],
      includeBlanks: false,
    };
    const columnData: CellValue[] = ['Apple', 'Banana', 'Cherry', 'Date'];

    const bitmap = bridge.evaluateAndCacheColumnFilter('table-1', 'col-a', criteria, columnData);

    // Apple and Cherry should be visible (1), Banana and Date hidden (0)
    expect(bitmap[0]).toBe(1); // Apple
    expect(bitmap[1]).toBe(0); // Banana
    expect(bitmap[2]).toBe(1); // Cherry
    expect(bitmap[3]).toBe(0); // Date
  });

  it('should return cached bitmap on second call', () => {
    const criteria: FilterCriteria = {
      type: 'values',
      included: ['Apple'],
      includeBlanks: false,
    };
    const columnData: CellValue[] = ['Apple', 'Banana'];

    const bitmap1 = bridge.evaluateAndCacheColumnFilter('table-1', 'col-a', criteria, columnData);
    const bitmap2 = bridge.evaluateAndCacheColumnFilter('table-1', 'col-a', criteria, columnData);

    // Same reference means it was cached
    expect(bitmap1).toBe(bitmap2);
  });

  it('should invalidate a specific column bitmap', () => {
    const criteria: FilterCriteria = {
      type: 'values',
      included: ['Apple'],
      includeBlanks: false,
    };
    const columnData: CellValue[] = ['Apple', 'Banana'];

    const bitmap1 = bridge.evaluateAndCacheColumnFilter('table-1', 'col-a', criteria, columnData);
    bridge.invalidateColumnBitmap('table-1', 'col-a');
    const bitmap2 = bridge.evaluateAndCacheColumnFilter('table-1', 'col-a', criteria, columnData);

    // Different reference means cache was cleared and re-evaluated
    expect(bitmap1).not.toBe(bitmap2);
    // But same content
    expect(Array.from(bitmap1)).toEqual(Array.from(bitmap2));
  });

  it('should invalidate all bitmaps for a table', () => {
    const criteria: FilterCriteria = {
      type: 'values',
      included: ['Apple'],
      includeBlanks: false,
    };

    bridge.evaluateAndCacheColumnFilter('table-1', 'col-a', criteria, ['Apple', 'Banana']);
    bridge.evaluateAndCacheColumnFilter('table-1', 'col-b', criteria, ['Apple', 'Cherry']);

    bridge.invalidateTableBitmaps('table-1');

    // After invalidation, getRowVisibility should return null (no cached bitmaps)
    expect(bridge.getRowVisibility('table-1')).toBeNull();
  });

  it('should compose bitmaps for row visibility', () => {
    // Column A: show only rows 0, 2
    const criteriaA: FilterCriteria = {
      type: 'values',
      included: ['A'],
      includeBlanks: false,
    };
    bridge.evaluateAndCacheColumnFilter('table-1', 'col-a', criteriaA, ['A', 'B', 'A', 'B']);

    // Column B: show only rows 0, 1
    const criteriaB: FilterCriteria = {
      type: 'values',
      included: ['X'],
      includeBlanks: false,
    };
    bridge.evaluateAndCacheColumnFilter('table-1', 'col-b', criteriaB, ['X', 'X', 'Y', 'Y']);

    const visibility = bridge.getRowVisibility('table-1');

    expect(visibility).not.toBeNull();
    // AND composition: row 0 = 1&1=1, row 1 = 0&1=0, row 2 = 1&0=0, row 3 = 0&0=0
    expect(visibility!.bitmap[0]).toBe(1);
    expect(visibility!.bitmap[1]).toBe(0);
    expect(visibility!.bitmap[2]).toBe(0);
    expect(visibility!.bitmap[3]).toBe(0);
    expect(visibility!.visibleCount).toBe(1);
    expect(visibility!.totalCount).toBe(4);
  });

  it('should return null from getRowVisibility when no bitmaps cached', () => {
    expect(bridge.getRowVisibility('table-1')).toBeNull();
  });
});

// =============================================================================
// TableBridge Event Subscription Tests
// =============================================================================

describe('TableBridge event subscriptions', () => {
  let bridge: TableBridge;
  let mockCtx: ReturnType<typeof createMockCtx>;
  const getCellValue = jest.fn<CellValue | undefined, [SheetId, number, number]>();

  beforeEach(() => {
    mockCtx = createMockCtx();
    getCellValue.mockReset();
    bridge = new TableBridge({
      ctx: mockCtx.ctx,
      getCellValue,
    });

    // Pre-populate cache
    const criteria: FilterCriteria = {
      type: 'values',
      included: ['A'],
      includeBlanks: false,
    };
    bridge.evaluateAndCacheColumnFilter('table-1', 'col-a', criteria, ['A', 'B']);
  });

  afterEach(() => {
    bridge.destroy();
  });

  it('should clear cache on cells:batch-changed', () => {
    mockCtx.eventBus.emit({
      type: 'cells:batch-changed',
      sheetId: 'sheet-1',
      changes: [{ row: 1, col: 0, oldValue: 'B', newValue: 'A' }],
      source: 'user',
    } as any);

    // Cache should be invalidated
    expect(bridge.getRowVisibility('table-1')).toBeNull();
  });

  it('should clear cache on table:deleted', () => {
    mockCtx.eventBus.emit({
      type: 'table:deleted',
      sheetId: 'sheet-1',
      tableId: 'table-1',
      source: 'user',
    } as any);

    expect(bridge.getRowVisibility('table-1')).toBeNull();
  });

  it('should clear cache on columns:deleted', () => {
    mockCtx.eventBus.emit({
      type: 'columns:deleted',
      sheetId: 'sheet-1',
      startCol: 0,
      count: 1,
      source: 'user',
    } as any);

    expect(bridge.getRowVisibility('table-1')).toBeNull();
  });

  it('should clear cache on rows:inserted', () => {
    mockCtx.eventBus.emit({
      type: 'rows:inserted',
      sheetId: 'sheet-1',
      startRow: 5,
      count: 2,
      source: 'user',
    } as any);

    expect(bridge.getRowVisibility('table-1')).toBeNull();
  });

  it('should clear cache on rows:deleted', () => {
    mockCtx.eventBus.emit({
      type: 'rows:deleted',
      sheetId: 'sheet-1',
      startRow: 3,
      count: 1,
      source: 'user',
    } as any);

    expect(bridge.getRowVisibility('table-1')).toBeNull();
  });

  it('should clear cache on filter:cleared', () => {
    mockCtx.eventBus.emit({
      type: 'filter:cleared',
      sheetId: 'sheet-1',
      filterId: 'filter-1',
      source: 'user',
    } as any);

    expect(bridge.getRowVisibility('table-1')).toBeNull();
  });

  it('should unsubscribe all on destroy', () => {
    bridge.destroy();

    // Re-populate cache manually to test that events no longer clear it
    const criteria: FilterCriteria = {
      type: 'values',
      included: ['A'],
      includeBlanks: false,
    };
    bridge.evaluateAndCacheColumnFilter('table-2', 'col-a', criteria, ['A', 'B']);

    // Emit event — should NOT clear cache since we destroyed subscriptions
    // But destroy also clears the cache, so we check the new one
    // Actually destroy clears cache too, so we need to re-populate after destroy
    // and check that new events don't trigger (the eventBus handler is removed)
    const bitmapBefore = bridge.evaluateAndCacheColumnFilter('table-3', 'col-x', criteria, [
      'A',
      'B',
    ]);

    // This event should not clear the cache because we already destroyed
    mockCtx.eventBus.emit({
      type: 'rows:inserted',
      sheetId: 'sheet-1',
      startRow: 0,
      count: 1,
      source: 'user',
    } as any);

    // The handler was removed by destroy, so cache should still exist
    // Note: the event might still fire to remaining handlers, but our bridge
    // unsubscribed, so it shouldn't react
    const bitmapAfter = bridge.evaluateAndCacheColumnFilter('table-3', 'col-x', criteria, [
      'A',
      'B',
    ]);
    expect(bitmapAfter).toBe(bitmapBefore); // Same cached reference
  });
});

// =============================================================================
// TableBridge getEngineTable Tests
// =============================================================================

describe('TableBridge.getEngineTable', () => {
  let bridge: TableBridge;

  beforeEach(() => {
    const { ctx } = createMockCtx();
    bridge = new TableBridge({
      ctx,
      getCellValue: () => undefined,
    });
  });

  afterEach(() => {
    bridge.destroy();
  });

  it('should return a properly converted table', () => {
    const config = createMockTableConfig();
    const range = createRange(0, 0, 10, 3);
    const table = bridge.getEngineTable(config, range);

    expect(table.id).toBe('table-1');
    expect(table.name).toBe('SalesData');
    expect(table.columns).toHaveLength(4);
    expect(table.style).toBe('TableStyleMedium2');
  });
});
