/**
 * Schema Validation Bridge Tests
 *
 * Unit tests for the SchemaValidationBridge — a thin adapter that processes
 * validation annotations from Rust compute-core and provides on-demand
 * validation via Rust.
 *
 * Tests cover:
 * - processValidationAnnotations (core new functionality)
 * - start/stop lifecycle (EventBus subscription management)
 * - On-demand validateCell (delegates to Rust)
 * - validateCell with empty value + required constraint
 * - validateColumn / validateSheet (bulk on-demand)
 * - getCellsWithErrors / getErrorSummary (error querying)
 *
 * @see schema-bridge.ts - Implementation
 */

// Polyfill window for Node test environment (devtools reporting uses `window`)
import { jest } from '@jest/globals';

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {};
}

import { sheetId } from '@mog-sdk/contracts/core';
import type { ColumnSchema } from '@mog-sdk/contracts/schema';

import { createEventBus } from '../../context/event-bus';

const eventBus = createEventBus();

// =============================================================================
// MOCKS
// =============================================================================

// Mock the kernel domain modules (schema-bridge imports from ../domain/*)
const mockGetColumnSchema = jest.fn();
const mockGetAllColumnSchemas = jest.fn().mockReturnValue(new Map());
const mockGetValue = jest.fn();
const mockSetMetadata = jest.fn();
const mockGetMetadata = jest.fn();
const mockQueryByMetadata = jest.fn().mockReturnValue([]);

jest.unstable_mockModule('../../domain/schemas/schemas', () => ({
  getColumnSchema: (...args: unknown[]) => mockGetColumnSchema(...args),
  getAllColumnSchemas: (...args: unknown[]) => mockGetAllColumnSchemas(...args),
}));

jest.unstable_mockModule('../../domain/cells/cell-reads', () => ({
  getValue: (...args: unknown[]) => mockGetValue(...args),
}));

jest.unstable_mockModule('../../domain/cells/cell-properties', () => ({
  setMetadata: (...args: unknown[]) => mockSetMetadata(...args),
  getMetadata: (...args: unknown[]) => mockGetMetadata(...args),
  queryByMetadata: (...args: unknown[]) => mockQueryByMetadata(...args),
}));

// Mock the compute-bridge for Rust schema validation
const mockRustSchemaValidate = jest.fn().mockResolvedValue({
  valid: true,
  errors: [],
  inferredType: 'text',
});

jest.unstable_mockModule('../compute/compute-bridge', () => ({
  rustSchemaValidate: (...args: unknown[]) => mockRustSchemaValidate(...args),
}));

const { SchemaValidationBridge } = await import('../schema-bridge');

/**
 * Helper: flush the microtask queue so fire-and-forget async validation completes.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// =============================================================================
// TEST UTILITIES
// =============================================================================

const SHEET_ID = sheetId('sheet-1');

/**
 * Create a minimal mock DocumentContext for the SchemaValidationBridge.
 */
function createMockCtx() {
  return {
    eventBus,
    refs: {
      doc: {} as any,
    },
    computeBridge: {
      getAllSheetIds: jest.fn().mockResolvedValue([SHEET_ID]),
      getSheetName: jest.fn().mockResolvedValue('Sheet1'),
      getDataBounds: jest.fn().mockResolvedValue({ minRow: 0, minCol: 0, maxRow: 99, maxCol: 25 }),
      queryRange: jest.fn().mockResolvedValue({ cells: [], merges: [] }),
    },
    doc: {
      transact: jest.fn((fn: Function) => fn()),
    },
  } as any;
}

/**
 * Create a number schema.
 */
function createNumberSchema(overrides?: Partial<ColumnSchema>): ColumnSchema {
  return {
    id: 'schema-1',
    type: 'number',
    name: 'Amount',
    ...overrides,
  };
}

/**
 * Create a text schema.
 */
function createTextSchema(overrides?: Partial<ColumnSchema>): ColumnSchema {
  return {
    id: 'schema-2',
    type: 'string',
    name: 'Name',
    ...overrides,
  };
}

/**
 * Emit a validation:recalc-annotations event.
 */
function emitRecalcAnnotations(
  annotations: Array<{
    cellId: string;
    sheetId: string;
    row: number;
    column: number;
    errors: Array<{ rule: string; message: string; severity: 'error' | 'warning' }>;
  }>,
) {
  eventBus.emit({
    type: 'validation:recalc-annotations',
    timestamp: Date.now(),
    annotations,
  } as any);
}

// =============================================================================
// SETUP / TEARDOWN
// =============================================================================

beforeEach(() => {
  jest.clearAllMocks();
  eventBus.clear();

  // Reset default return values
  mockGetColumnSchema.mockReturnValue(undefined);
  mockGetAllColumnSchemas.mockReturnValue(new Map());
  mockGetValue.mockReturnValue(undefined);
  mockSetMetadata.mockImplementation(() => {});
  mockGetMetadata.mockReturnValue(undefined);
  mockQueryByMetadata.mockReturnValue([]);
  mockRustSchemaValidate.mockResolvedValue({ valid: true, errors: [], inferredType: 'text' });
});

// =============================================================================
// PROCESS VALIDATION ANNOTATIONS
// =============================================================================

describe('SchemaValidationBridge - processValidationAnnotations', () => {
  it('should store errors in metadata and emit validation:failed for annotation with errors', () => {
    const ctx = createMockCtx();
    const schema = createNumberSchema();
    mockGetColumnSchema.mockReturnValue(schema);
    mockGetValue.mockReturnValue('bad-value');

    const bridge = new SchemaValidationBridge(ctx);

    const failedEvents: any[] = [];
    eventBus.on('validation:failed' as any, (e: any) => failedEvents.push(e));

    bridge.processValidationAnnotations([
      {
        cellId: 'cell-1',
        sheetId: SHEET_ID as string,
        row: 2,
        column: 3,
        errors: [{ rule: 'TYPE_MISMATCH', message: 'Expected number', severity: 'error' }],
      },
    ]);

    // Should store errors in cell metadata
    expect(mockSetMetadata).toHaveBeenCalledTimes(1);
    expect(mockSetMetadata).toHaveBeenCalledWith(
      ctx,
      SHEET_ID,
      2,
      3,
      {
        validationErrors: [
          { rule: 'TYPE_MISMATCH', message: 'Expected number', severity: 'error' },
        ],
      },
      'validation',
    );

    // Should emit validation:failed event
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0].type).toBe('validation:failed');
    expect(failedEvents[0].sheetId).toBe(SHEET_ID);
    expect(failedEvents[0].row).toBe(2);
    expect(failedEvents[0].col).toBe(3);
    expect(failedEvents[0].errors).toHaveLength(1);
    expect(failedEvents[0].errors[0].code).toBe('TYPE_MISMATCH');
  });

  it('should clear errors and emit validation:passed for annotation with empty errors', () => {
    const ctx = createMockCtx();
    mockGetValue.mockReturnValue(42);

    const bridge = new SchemaValidationBridge(ctx);

    const passedEvents: any[] = [];
    eventBus.on('validation:passed' as any, (e: any) => passedEvents.push(e));

    bridge.processValidationAnnotations([
      {
        cellId: 'cell-1',
        sheetId: SHEET_ID as string,
        row: 1,
        column: 5,
        errors: [],
      },
    ]);

    // Should clear validation errors in metadata
    expect(mockSetMetadata).toHaveBeenCalledTimes(1);
    expect(mockSetMetadata).toHaveBeenCalledWith(
      ctx,
      SHEET_ID,
      1,
      5,
      { validationErrors: [] },
      'validation',
    );

    // Should emit validation:passed event
    expect(passedEvents).toHaveLength(1);
    expect(passedEvents[0].type).toBe('validation:passed');
    expect(passedEvents[0].sheetId).toBe(SHEET_ID);
    expect(passedEvents[0].row).toBe(1);
    expect(passedEvents[0].col).toBe(5);
    // value is null because processValidationAnnotations doesn't fetch cell values (async)
    expect(passedEvents[0].value).toBeNull();
  });

  it('should process multiple annotations correctly', () => {
    const ctx = createMockCtx();
    const schema = createNumberSchema();
    mockGetColumnSchema.mockReturnValue(schema);
    mockGetValue.mockReturnValue('some-value');

    const bridge = new SchemaValidationBridge(ctx);

    const failedEvents: any[] = [];
    const passedEvents: any[] = [];
    eventBus.on('validation:failed' as any, (e: any) => failedEvents.push(e));
    eventBus.on('validation:passed' as any, (e: any) => passedEvents.push(e));

    bridge.processValidationAnnotations([
      {
        cellId: 'cell-1',
        sheetId: SHEET_ID as string,
        row: 0,
        column: 0,
        errors: [{ rule: 'TYPE_MISMATCH', message: 'Expected number', severity: 'error' }],
      },
      {
        cellId: 'cell-2',
        sheetId: SHEET_ID as string,
        row: 1,
        column: 0,
        errors: [],
      },
      {
        cellId: 'cell-3',
        sheetId: SHEET_ID as string,
        row: 2,
        column: 0,
        errors: [
          { rule: 'MIN', message: 'Below minimum', severity: 'warning' },
          { rule: 'MAX', message: 'Above maximum', severity: 'error' },
        ],
      },
    ]);

    // setMetadata called 3 times (error store, clear, error store)
    expect(mockSetMetadata).toHaveBeenCalledTimes(3);

    // 2 failed events (row 0 and row 2), 1 passed event (row 1)
    expect(failedEvents).toHaveLength(2);
    expect(passedEvents).toHaveLength(1);

    expect(failedEvents[0].row).toBe(0);
    expect(failedEvents[1].row).toBe(2);
    expect(failedEvents[1].errors).toHaveLength(2);
    expect(passedEvents[0].row).toBe(1);
  });

  it('should not emit events when emitEvents option is false', () => {
    const ctx = createMockCtx();
    const schema = createNumberSchema();
    mockGetColumnSchema.mockReturnValue(schema);
    mockGetValue.mockReturnValue('value');

    const bridge = new SchemaValidationBridge(ctx, { emitEvents: false });

    const failedEvents: any[] = [];
    const passedEvents: any[] = [];
    eventBus.on('validation:failed' as any, (e: any) => failedEvents.push(e));
    eventBus.on('validation:passed' as any, (e: any) => passedEvents.push(e));

    bridge.processValidationAnnotations([
      {
        cellId: 'cell-1',
        sheetId: SHEET_ID as string,
        row: 0,
        column: 0,
        errors: [{ rule: 'TYPE_MISMATCH', message: 'Expected number', severity: 'error' }],
      },
      {
        cellId: 'cell-2',
        sheetId: SHEET_ID as string,
        row: 1,
        column: 0,
        errors: [],
      },
    ]);

    // Metadata should still be stored
    expect(mockSetMetadata).toHaveBeenCalledTimes(2);

    // But no events emitted
    expect(failedEvents).toHaveLength(0);
    expect(passedEvents).toHaveLength(0);
  });
});

// =============================================================================
// START / STOP LIFECYCLE
// =============================================================================

describe('SchemaValidationBridge - start/stop', () => {
  it('should subscribe to validation:recalc-annotations on start', () => {
    const ctx = createMockCtx();
    const schema = createNumberSchema();
    mockGetColumnSchema.mockReturnValue(schema);
    mockGetValue.mockReturnValue('value');

    const bridge = new SchemaValidationBridge(ctx);
    bridge.start();

    const failedEvents: any[] = [];
    eventBus.on('validation:failed' as any, (e: any) => failedEvents.push(e));

    // Emit a recalc annotation event — bridge should process it
    emitRecalcAnnotations([
      {
        cellId: 'cell-1',
        sheetId: SHEET_ID as string,
        row: 0,
        column: 0,
        errors: [{ rule: 'TYPE_MISMATCH', message: 'bad', severity: 'error' }],
      },
    ]);

    expect(mockSetMetadata).toHaveBeenCalledTimes(1);
    expect(failedEvents).toHaveLength(1);

    bridge.stop();
  });

  it('should unsubscribe from events on stop', () => {
    const ctx = createMockCtx();
    const schema = createNumberSchema();
    mockGetColumnSchema.mockReturnValue(schema);

    const bridge = new SchemaValidationBridge(ctx);
    bridge.start();
    bridge.stop();

    // Emit after stop — bridge should NOT process it
    emitRecalcAnnotations([
      {
        cellId: 'cell-1',
        sheetId: SHEET_ID as string,
        row: 0,
        column: 0,
        errors: [{ rule: 'TYPE_MISMATCH', message: 'bad', severity: 'error' }],
      },
    ]);

    expect(mockSetMetadata).not.toHaveBeenCalled();
  });

  it('should return a cleanup function from start()', () => {
    const ctx = createMockCtx();
    const schema = createNumberSchema();
    mockGetColumnSchema.mockReturnValue(schema);

    const bridge = new SchemaValidationBridge(ctx);
    const cleanup = bridge.start();

    // Call cleanup directly
    cleanup();

    // Emit after cleanup — bridge should NOT process it
    emitRecalcAnnotations([
      {
        cellId: 'cell-1',
        sheetId: SHEET_ID as string,
        row: 0,
        column: 0,
        errors: [{ rule: 'TYPE_MISMATCH', message: 'bad', severity: 'error' }],
      },
    ]);

    expect(mockSetMetadata).not.toHaveBeenCalled();
  });
});

// =============================================================================
// ON-DEMAND VALIDATION — validateCell
// =============================================================================

describe('SchemaValidationBridge - validateCell (on-demand)', () => {
  it('should delegate to Rust and emit validation:passed for valid value', async () => {
    const ctx = createMockCtx();
    const schema = createNumberSchema();
    mockGetColumnSchema.mockReturnValue(schema);
    mockRustSchemaValidate.mockResolvedValue({
      valid: true,
      errors: [],
      inferredType: 'number',
    });

    const bridge = new SchemaValidationBridge(ctx);

    const passedEvents: any[] = [];
    eventBus.on('validation:passed' as any, (e: any) => passedEvents.push(e));

    bridge.validateCell(SHEET_ID, 0, 0, 42);
    await flushMicrotasks();

    expect(mockRustSchemaValidate).toHaveBeenCalledTimes(1);
    expect(passedEvents).toHaveLength(1);
    expect(passedEvents[0].row).toBe(0);
    expect(passedEvents[0].col).toBe(0);
  });

  it('should delegate to Rust and emit validation:failed for invalid value', async () => {
    const ctx = createMockCtx();
    const schema = createNumberSchema();
    mockGetColumnSchema.mockReturnValue(schema);
    mockRustSchemaValidate.mockResolvedValue({
      valid: false,
      errors: [{ code: 'TYPE_MISMATCH', message: 'Expected number, got text', severity: 'error' }],
      inferredType: 'text',
    });

    const bridge = new SchemaValidationBridge(ctx);

    const failedEvents: any[] = [];
    eventBus.on('validation:failed' as any, (e: any) => failedEvents.push(e));

    bridge.validateCell(SHEET_ID, 1, 0, 'not-a-number');
    await flushMicrotasks();

    expect(mockRustSchemaValidate).toHaveBeenCalledTimes(1);
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0].row).toBe(1);
    expect(failedEvents[0].col).toBe(0);
    expect(failedEvents[0].errors).toHaveLength(1);
    expect(failedEvents[0].errors[0].code).toBe('TYPE_MISMATCH');

    // Should store errors in metadata
    expect(mockSetMetadata).toHaveBeenCalled();
  });

  it('should skip validation when no schema exists for the column', async () => {
    const ctx = createMockCtx();
    mockGetColumnSchema.mockReturnValue(undefined);

    const bridge = new SchemaValidationBridge(ctx);

    bridge.validateCell(SHEET_ID, 0, 0, 'anything');
    await flushMicrotasks();

    expect(mockRustSchemaValidate).not.toHaveBeenCalled();
    expect(mockSetMetadata).not.toHaveBeenCalled();
  });

  it('should handle empty value with required constraint', () => {
    const ctx = createMockCtx();
    const schema = createTextSchema({ constraints: { required: true } });
    mockGetColumnSchema.mockReturnValue(schema);

    const bridge = new SchemaValidationBridge(ctx);

    const failedEvents: any[] = [];
    eventBus.on('validation:failed' as any, (e: any) => failedEvents.push(e));

    bridge.validateCell(SHEET_ID, 0, 0, '');

    // Should not call Rust for empty values
    expect(mockRustSchemaValidate).not.toHaveBeenCalled();

    // Should store REQUIRED error in metadata
    expect(mockSetMetadata).toHaveBeenCalled();
    const metaArg = mockSetMetadata.mock.calls[mockSetMetadata.mock.calls.length - 1];
    expect(metaArg[3]).toBe(0); // col
    expect(metaArg[4]).toEqual({
      validationErrors: expect.arrayContaining([expect.objectContaining({ rule: 'REQUIRED' })]),
    });

    // Should emit validation:failed
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0].errors[0].code).toBe('REQUIRED');
  });

  it('should clear errors for empty value without required constraint', () => {
    const ctx = createMockCtx();
    const schema = createTextSchema(); // no required constraint
    mockGetColumnSchema.mockReturnValue(schema);

    const bridge = new SchemaValidationBridge(ctx);

    bridge.validateCell(SHEET_ID, 0, 0, null);

    // Should not call Rust
    expect(mockRustSchemaValidate).not.toHaveBeenCalled();

    // Should clear metadata (set empty validationErrors)
    expect(mockSetMetadata).toHaveBeenCalledWith(
      ctx,
      SHEET_ID,
      0,
      0,
      { validationErrors: [] },
      'validation',
    );
  });

  it('should handle null and undefined as empty values', () => {
    const ctx = createMockCtx();
    const schema = createTextSchema();
    mockGetColumnSchema.mockReturnValue(schema);

    const bridge = new SchemaValidationBridge(ctx);

    bridge.validateCell(SHEET_ID, 0, 0, null);
    bridge.validateCell(SHEET_ID, 1, 0, undefined);
    bridge.validateCell(SHEET_ID, 2, 0, '');

    // None should call Rust
    expect(mockRustSchemaValidate).not.toHaveBeenCalled();

    // All should clear errors (3 calls)
    expect(mockSetMetadata).toHaveBeenCalledTimes(3);
  });
});

// =============================================================================
// BULK VALIDATION — validateColumn / validateSheet
// =============================================================================

describe('SchemaValidationBridge - validateColumn / validateSheet', () => {
  it('validateColumn should validate all cells in a column', async () => {
    const ctx = createMockCtx();
    const schema = createNumberSchema();
    mockGetColumnSchema.mockReturnValue(schema);
    mockRustSchemaValidate.mockResolvedValue({ valid: true, errors: [], inferredType: 'number' });

    ctx.computeBridge.queryRange.mockResolvedValue({
      cells: [
        { row: 0, col: 2, value: 10 },
        { row: 1, col: 2, value: 20 },
        { row: 2, col: 2, value: 30 },
      ],
      merges: [],
    });

    const bridge = new SchemaValidationBridge(ctx);
    await bridge.validateColumn(SHEET_ID, 2);
    await flushMicrotasks();

    expect(ctx.computeBridge.getDataBounds).toHaveBeenCalledWith(SHEET_ID);
    expect(ctx.computeBridge.queryRange).toHaveBeenCalled();
    // validateCell called for each cell in the column
    expect(mockRustSchemaValidate).toHaveBeenCalledTimes(3);
  });

  it('validateColumn should skip when no schema exists', async () => {
    const ctx = createMockCtx();
    mockGetColumnSchema.mockReturnValue(undefined);

    const bridge = new SchemaValidationBridge(ctx);
    await bridge.validateColumn(SHEET_ID, 0);

    expect(ctx.computeBridge.getDataBounds).not.toHaveBeenCalled();
  });

  it('validateSheet should validate all columns with schemas', async () => {
    const ctx = createMockCtx();
    const schema = createNumberSchema();
    mockGetAllColumnSchemas.mockReturnValue(
      new Map([
        [0, schema],
        [3, schema],
      ]),
    );
    mockGetColumnSchema.mockReturnValue(schema);
    mockRustSchemaValidate.mockResolvedValue({ valid: true, errors: [], inferredType: 'number' });
    ctx.computeBridge.queryRange.mockResolvedValue({
      cells: [{ row: 0, col: 0, value: 10 }],
      merges: [],
    });

    const bridge = new SchemaValidationBridge(ctx);
    await bridge.validateSheet(SHEET_ID);
    await flushMicrotasks();

    // getDataBounds called once per column with schema
    expect(ctx.computeBridge.getDataBounds).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// ERROR QUERYING — getCellsWithErrors / getErrorSummary
// =============================================================================

describe('SchemaValidationBridge - error querying', () => {
  it('getCellsWithErrors should return cells with validation errors', async () => {
    const ctx = createMockCtx();
    mockQueryByMetadata.mockReturnValue([
      { row: 0, col: 1 },
      { row: 2, col: 1 },
    ]);
    mockGetMetadata
      .mockResolvedValueOnce({
        validationErrors: [{ rule: 'TYPE_MISMATCH', message: 'bad', severity: 'error' }],
      })
      .mockResolvedValueOnce({
        validationErrors: [{ rule: 'MIN', message: 'too low', severity: 'warning' }],
      });

    const bridge = new SchemaValidationBridge(ctx);
    const results = await bridge.getCellsWithErrors(SHEET_ID);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      row: 0,
      col: 1,
      errors: [{ rule: 'TYPE_MISMATCH', message: 'bad', severity: 'error' }],
    });
    expect(results[1]).toEqual({
      row: 2,
      col: 1,
      errors: [{ rule: 'MIN', message: 'too low', severity: 'warning' }],
    });
  });

  it('getErrorSummary should aggregate error and warning counts', async () => {
    const ctx = createMockCtx();
    mockQueryByMetadata.mockReturnValue([
      { row: 0, col: 0 },
      { row: 1, col: 0 },
    ]);
    mockGetMetadata
      .mockResolvedValueOnce({
        validationErrors: [
          { rule: 'TYPE_MISMATCH', message: 'bad', severity: 'error' },
          { rule: 'MAX', message: 'too high', severity: 'warning' },
        ],
      })
      .mockResolvedValueOnce({
        validationErrors: [{ rule: 'MIN', message: 'too low', severity: 'error' }],
      });

    const bridge = new SchemaValidationBridge(ctx);
    const summary = await bridge.getErrorSummary(SHEET_ID);

    expect(summary).toEqual({
      totalErrors: 2,
      totalWarnings: 1,
      cellsWithErrors: 2,
    });
  });

  it('getErrorSummary should return zeros when no errors', async () => {
    const ctx = createMockCtx();
    mockQueryByMetadata.mockReturnValue([]);

    const bridge = new SchemaValidationBridge(ctx);
    const summary = await bridge.getErrorSummary(SHEET_ID);

    expect(summary).toEqual({
      totalErrors: 0,
      totalWarnings: 0,
      cellsWithErrors: 0,
    });
  });
});
