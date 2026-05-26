/**
 * Test Sheet Factory - Schema-Driven Test Utilities
 *
 * This module provides test utilities that create sheets and workbooks
 * using the same schemas as production code. This ensures:
 * - Test sheets have all required fields
 * - Tests stay in sync with schema changes automatically
 * - Consistent test setup across all test files
 *
 * Uses plain Maps with MapLike wrappers that
 * expose .get()/.set()/.has()/.delete()/.forEach()/.size.
 *
 * USAGE:
 * ```typescript
 * import { createTestSheet, createTestWorkbook, createTestCell } from '@mog/spreadsheet-testing/fixtures';
 *
 * // Create a simple test sheet
 * const sheet = createTestSheet({ name: 'Test Sheet' });
 *
 * // Create a complete workbook with multiple sheets
 * const { sheets } = createTestWorkbook({ sheetCount: 3 });
 * ```
 *
 */

import { createSheetMetaDefaults, type SheetMetaDefaults } from '@mog-sdk/kernel/testing';

// =============================================================================
// MapLike - Plain Map wrapper matching Y.Map interface used by consumers
// =============================================================================

/**
 * A plain Map that exposes the same interface as Y.Map for consumer compatibility.
 * Consumers that previously used `sheet.get('cells') as Y.Map<unknown>` can now
 * use `sheet.get('cells') as MapLike<unknown>` with the same API.
 */
export class MapLike<V = unknown> extends Map<string, V> {
  /**
   * Convert to a plain object (useful for serialization)
   */
  toJSON(): Record<string, V> {
    const result: Record<string, V> = {};
    for (const [key, value] of this) {
      result[key] = value;
    }
    return result;
  }
}

/**
 * ArrayLike wraps a plain array with push/toArray access.
 * Replaces Y.Array usage in test sheets.
 */
export class ArrayLike<V = unknown> {
  private items: V[] = [];

  get length(): number {
    return this.items.length;
  }

  push(values: V[]): void {
    this.items.push(...values);
  }

  toArray(): V[] {
    return [...this.items];
  }

  toJSON(): V[] {
    return this.toArray();
  }
}

type SheetMetaDefaultValue = SheetMetaDefaults[keyof SheetMetaDefaults];
type SheetMetaDefaultKey = Extract<keyof SheetMetaDefaults, string>;

function cloneDefaultValue(defaultValue: SheetMetaDefaultValue): SheetMetaDefaultValue {
  if (Array.isArray(defaultValue)) {
    return defaultValue.map((item) => ({ ...item }));
  }
  return defaultValue;
}

// =============================================================================
// Test Sheet Factory
// =============================================================================

/**
 * Options for creating a test sheet.
 */
export interface CreateTestSheetOptions {
  /**
   * The sheet ID. Defaults to a unique ID based on timestamp.
   */
  sheetId?: string;

  /**
   * The sheet name. Defaults to 'Test Sheet'.
   */
  name?: string;

  /**
   * Override any field in the sheet container.
   * Use this for specialized test scenarios that need non-default values.
   */
  overrides?: Partial<Record<string, unknown>>;

  /**
   * Override any field in the sheet meta.
   * Use this for testing specific meta configurations.
   */
  metaOverrides?: Partial<Record<string, unknown>>;
}

/**
 * Create a test sheet with all required fields initialized.
 * Uses the same schemas as production code to ensure consistency.
 *
 * @param docOrOptions - CreateTestSheetOptions
 * @param options - Configuration options for the test sheet (when first arg is a doc)
 * @returns A MapLike representing the sheet with all required fields
 *
 * @example
 * ```typescript
 * // Basic usage (new API)
 * const sheet = createTestSheet();
 *
 * // With custom name
 * const sheet2 = createTestSheet({ name: 'Revenue Analysis' });
 *
 * // With meta overrides
 * const sheet3 = createTestSheet({
 *   metaOverrides: { frozenRows: 2, frozenCols: 1 }
 * });
 *
 * // Legacy API (doc is ignored)
 * const sheet4 = createTestSheet(doc, { name: 'Legacy' });
 * ```
 */
export function createTestSheet(
  docOrOptions?: unknown | CreateTestSheetOptions,
  options?: CreateTestSheetOptions,
): MapLike<unknown> {
  // Support both old API: createTestSheet(doc, options) and new: createTestSheet(options)
  let opts: CreateTestSheetOptions;
  if (options !== undefined) {
    // Old API: first arg is doc (ignored), second is options
    opts = options;
  } else if (
    docOrOptions !== undefined &&
    typeof docOrOptions === 'object' &&
    docOrOptions !== null &&
    !('getMap' in docOrOptions)
  ) {
    // New API: first arg is options
    opts = docOrOptions as CreateTestSheetOptions;
  } else {
    // Called as createTestSheet(doc) with no options, or createTestSheet()
    opts = {};
  }

  const sheetId = opts.sheetId || crypto.randomUUID();
  const name = opts.name || 'Test Sheet';

  const container = new MapLike<unknown>();

  // Core Data
  const meta = new MapLike<unknown>();
  const cells = new MapLike<unknown>();
  const properties = new MapLike<unknown>();
  const grid = new MapLike<unknown>();
  const rowHeights = new MapLike<unknown>();
  const colWidths = new MapLike<unknown>();
  const charts = new MapLike<unknown>();
  const schemas = new MapLike<unknown>();

  // Row/Column Identity Model
  const rows = new MapLike<unknown>();
  const cols = new MapLike<unknown>();
  const rowIndex = new MapLike<unknown>();
  const colIndex = new MapLike<unknown>();
  const rowFormats = new MapLike<unknown>();
  const colFormats = new MapLike<unknown>();
  const rangeSchemas = new MapLike<unknown>();

  // Structure Features
  const merges = new MapLike<unknown>();
  const hiddenRows = new ArrayLike<number>();
  const hiddenCols = new ArrayLike<number>();
  const tables = new MapLike<unknown>();
  const groupingConfig = new MapLike<unknown>();

  // Floating Objects
  const floatingObjects = new MapLike<unknown>();
  const floatingObjectGroups = new MapLike<unknown>();

  // Set all fields on container
  container.set('meta', meta);
  container.set('cells', cells);
  container.set('properties', properties);
  container.set('grid', grid);
  container.set('rowHeights', rowHeights);
  container.set('colWidths', colWidths);
  container.set('charts', charts);
  container.set('schemas', schemas);
  container.set('rows', rows);
  container.set('cols', cols);
  container.set('rowIndex', rowIndex);
  container.set('colIndex', colIndex);
  container.set('rowFormats', rowFormats);
  container.set('colFormats', colFormats);
  container.set('rangeSchemas', rangeSchemas);
  container.set('merges', merges);
  container.set('hiddenRows', hiddenRows);
  container.set('hiddenCols', hiddenCols);
  container.set('tables', tables);
  container.set('groupingConfig', groupingConfig);
  container.set('floatingObjects', floatingObjects);
  container.set('floatingObjectGroups', floatingObjectGroups);

  // Set meta fields
  meta.set('id', sheetId);
  meta.set('name', name);

  // Apply schema-derived defaults for meta fields.
  const sheetMetaDefaults = createSheetMetaDefaults();
  for (const key of Object.keys(sheetMetaDefaults) as SheetMetaDefaultKey[]) {
    if (!meta.has(key)) {
      meta.set(key, cloneDefaultValue(sheetMetaDefaults[key]));
    }
  }

  // Apply meta overrides
  if (opts.metaOverrides) {
    for (const [key, value] of Object.entries(opts.metaOverrides)) {
      meta.set(key, value);
    }
  }

  // Apply container overrides
  if (opts.overrides) {
    for (const [key, value] of Object.entries(opts.overrides)) {
      container.set(key, value);
    }
  }

  return container;
}

// =============================================================================
// Test Workbook Factory
// =============================================================================

/**
 * Options for creating a test workbook.
 */
export interface CreateTestWorkbookOptions {
  /**
   * Number of sheets to create. Defaults to 1.
   * Ignored if sheetNames is provided.
   */
  sheetCount?: number;

  /**
   * Names for each sheet. If provided, overrides sheetCount.
   */
  sheetNames?: string[];

  /**
   * Per-sheet options keyed by sheet index.
   * Use this for customizing individual sheets.
   */
  sheetOptions?: Record<number, CreateTestSheetOptions>;
}

/**
 * Result of creating a test workbook.
 */
export interface TestWorkbook {
  /**
   * Array of sheet containers in creation order.
   */
  sheets: MapLike<unknown>[];

  /**
   * The 'sheets' map for direct access.
   */
  sheetsMap: MapLike<unknown>;

  /**
   * Get a sheet by name.
   */
  getSheet(name: string): MapLike<unknown> | undefined;

  /**
   * Get a sheet by ID.
   */
  getSheetById(id: string): MapLike<unknown> | undefined;
}

/**
 * Create a complete test workbook with multiple sheets.
 *
 * @param options - Configuration options for the workbook
 * @returns A TestWorkbook object with sheets and helper methods
 *
 * @example
 * ```typescript
 * // Single sheet (default)
 * const { sheets } = createTestWorkbook();
 *
 * // Multiple sheets
 * const { sheets } = createTestWorkbook({ sheetCount: 3 });
 *
 * // Named sheets
 * const { sheets, getSheet } = createTestWorkbook({
 *   sheetNames: ['Summary', 'Raw Data', 'Charts']
 * });
 * const summarySheet = getSheet('Summary');
 * ```
 */
export function createTestWorkbook(options: CreateTestWorkbookOptions = {}): TestWorkbook {
  const sheetCount = options.sheetNames?.length || options.sheetCount || 1;
  const sheets: MapLike<unknown>[] = [];
  const sheetsMap = new MapLike<unknown>();

  for (let i = 0; i < sheetCount; i++) {
    const name = options.sheetNames?.[i] || `Sheet${i + 1}`;
    const sheetId = `sheet-${i}`;

    const sheetOpts = options.sheetOptions?.[i];

    const sheetContainer = createTestSheet({
      sheetId,
      name,
      metaOverrides: sheetOpts?.metaOverrides,
      overrides: sheetOpts?.overrides,
    });

    sheetsMap.set(sheetId, sheetContainer);
    sheets.push(sheetContainer);
  }

  return {
    sheets,
    sheetsMap,

    getSheet(name: string): MapLike<unknown> | undefined {
      const nameLower = name.toLowerCase();
      return sheets.find((sheet) => {
        const meta = sheet.get('meta') as MapLike<unknown>;
        return (meta.get('name') as string)?.toLowerCase() === nameLower;
      });
    },

    getSheetById(id: string): MapLike<unknown> | undefined {
      return sheetsMap.get(id) as MapLike<unknown> | undefined;
    },
  };
}

// =============================================================================
// Test Cell Factory
// =============================================================================

/**
 * Options for creating test cell data.
 */
export interface CreateTestCellOptions {
  /**
   * The cell ID. Defaults to a unique ID.
   */
  id?: string;

  /**
   * Row index (0-based).
   */
  row?: number;

  /**
   * Column index (0-based).
   */
  col?: number;

  /**
   * The raw/result value of the cell.
   */
  value?: unknown;

  /**
   * The formula string (without leading '=').
   */
  formula?: string;
}

/**
 * Create test cell data matching the serialized cell data structure.
 *
 * @param options - Configuration options for the cell
 * @returns A record representing cell data
 *
 * @example
 * ```typescript
 * // Simple value cell
 * const cell = createTestCell({ row: 0, col: 0, value: 'Hello' });
 *
 * // Formula cell
 * const formulaCell = createTestCell({
 *   row: 1,
 *   col: 0,
 *   formula: 'A1*2',
 *   value: 10  // computed result
 * });
 *
 * // Add to sheet
 * const cells = sheet.get('cells') as MapLike<unknown>;
 * cells.set(cell.id, cell);
 * ```
 */
export function createTestCell(options: CreateTestCellOptions = {}): Record<string, unknown> {
  const id = options.id || `cell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const cell: Record<string, unknown> = {
    id,
    row: options.row ?? 0,
    col: options.col ?? 0,
  };

  // Only include value if provided
  if (options.value !== undefined) {
    cell.r = options.value;
  }

  // Only include formula if provided
  if (options.formula !== undefined) {
    cell.f = options.formula;
  }

  return cell;
}

// =============================================================================
// Test Data Helpers
// =============================================================================

/**
 * Add cells to a sheet in a grid pattern.
 *
 * @param sheet - The sheet to add cells to
 * @param data - 2D array of values (rows x cols)
 * @param options - Starting position and other options
 * @returns Array of cell IDs that were created
 *
 * @example
 * ```typescript
 * const { sheets } = createTestWorkbook();
 * const sheet = sheets[0];
 *
 * // Add a 3x3 grid of values
 * addCellsToSheet(sheet, [
 *   ['Name', 'Age', 'City'],
 *   ['Alice', 30, 'NYC'],
 *   ['Bob', 25, 'LA']
 * ]);
 * ```
 */
export function addCellsToSheet(
  sheet: MapLike<unknown>,
  data: unknown[][],
  options: { startRow?: number; startCol?: number } = {},
): string[] {
  const { startRow = 0, startCol = 0 } = options;
  const cells = sheet.get('cells') as MapLike<unknown>;
  const cellIds: string[] = [];

  for (let rowOffset = 0; rowOffset < data.length; rowOffset++) {
    const row = data[rowOffset];
    for (let colOffset = 0; colOffset < row.length; colOffset++) {
      const value = row[colOffset];
      if (value !== undefined && value !== null) {
        const cell = createTestCell({
          row: startRow + rowOffset,
          col: startCol + colOffset,
          value,
        });
        cells.set(cell.id as string, cell);
        cellIds.push(cell.id as string);
      }
    }
  }

  return cellIds;
}

/**
 * Get a cell from a sheet by row and column.
 *
 * @param sheet - The sheet to search
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns The cell data or undefined if not found
 */
export function getCellAt(
  sheet: MapLike<unknown>,
  row: number,
  col: number,
): Record<string, unknown> | undefined {
  const cells = sheet.get('cells') as MapLike<unknown>;
  let foundCell: Record<string, unknown> | undefined;

  cells.forEach((cell) => {
    const cellData = cell as Record<string, unknown>;
    if (cellData.row === row && cellData.col === col) {
      foundCell = cellData;
    }
  });

  return foundCell;
}
