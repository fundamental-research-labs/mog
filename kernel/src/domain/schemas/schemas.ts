/**
 * Schemas Domain Module
 *
 * Column schema and range schema (data validation) operations.
 *
 * Column schemas: writes go to ComputeBridge (Rust); reads from local cache.
 * Range schemas: MIGRATED to Rust via ComputeBridge. Legacy sync reads
 *   (getRangeSchema) return undefined; callers should use ws.getValidation().
 *
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type { SchemaChangedEvent, SchemasInferredEvent } from '@mog-sdk/contracts/events';
import type {
  CellSchemaType,
  ColumnSchema,
  DistributionConfig,
  EnforcementLevel,
  InferredSchema,
  RangeSchema,
  SchemaConstraints,
} from '@mog-sdk/contracts/schema';

import type { CellValue } from '@mog-sdk/contracts/core';
import type { ColumnSchemaWire, SchemaConstraintsWire } from '../../bridges/compute/types';

interface SchemaDomainContext {
  readonly computeBridge: {
    updateSchema(
      sheetId: SheetId,
      colIndex: number,
      schema: ColumnSchemaWire,
      version: number,
    ): Promise<unknown>;
    removeSchema(sheetId: SheetId, colIndex: number, version: number): Promise<unknown>;
    queryRange(
      sheetId: SheetId,
      startRow: number,
      startCol: number,
      endRow: number,
      endCol: number,
    ): Promise<{ cells: Array<{ row: number; col: number; value: CellValue | null }> } | null>;
    schemaInferColumn(values: CellValue[]): Promise<{
      schema: ColumnSchemaWire;
      confidence: number;
      sampleSize: number;
      typesFound: Record<string, number>;
    }>;
  };
  readonly eventBus: {
    emit(event: SchemaChangedEvent | SchemasInferredEvent): void;
  };
}

// =============================================================================
// Local Caches (replace CRDT maps)
// =============================================================================

/**
 * Local in-memory cache for column schemas.
 * Keyed by sheetId -> colIndex -> ColumnSchema.
 * Updated on writes; provides sync reads without CRDT.
 */
const columnSchemaCache = new Map<SheetId, Map<number, ColumnSchema>>();

/**
 * Schema version counter for CB write versioning.
 */
let schemaVersion = 0;

// =============================================================================
// Internal Helpers: Column Schema Wire Conversion
// =============================================================================

/**
 * Convert a ColumnSchema to the wire format for Rust IPC.
 */
function columnSchemaToWire(schema: ColumnSchema): ColumnSchemaWire {
  return {
    id: schema.id,
    name: schema.name,
    type: schema.type,
    constraints: schema.constraints as SchemaConstraintsWire | undefined,
    distribution: schema.distribution,
    description: schema.description,
  };
}

/**
 * Get or create the column schema map for a sheet.
 */
function getColumnSchemaMap(sheetId: SheetId): Map<number, ColumnSchema> {
  let map = columnSchemaCache.get(sheetId);
  if (!map) {
    map = new Map();
    columnSchemaCache.set(sheetId, map);
  }
  return map;
}

// =============================================================================
// Column Schema Operations
// =============================================================================

/**
 * Get the schema for a column.
 *
 * Reads from the local column schema cache (sync).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param colIndex - Column index (0-based)
 * @returns Column schema or undefined
 */
export function getColumnSchema(
  ctx: SchemaDomainContext,
  sheetId: SheetId,
  colIndex: number,
): ColumnSchema | undefined {
  void ctx; // ctx reserved for future CB read method
  const map = columnSchemaCache.get(sheetId);
  if (!map) return undefined;
  return map.get(colIndex);
}

/**
 * Set or update the schema for a column.
 * Writes to ComputeBridge (fire-and-forget) and updates local cache.
 * Emits 'schema:changed' event via the event bus.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param colIndex - Column index (0-based)
 * @param schema - Schema to set
 * @param origin - Transaction origin (default: 'user')
 */
export function setColumnSchema(
  ctx: SchemaDomainContext,
  sheetId: SheetId,
  colIndex: number,
  schema: ColumnSchema,
  origin: string = 'user',
): void {
  const map = getColumnSchemaMap(sheetId);

  // Capture old schema for event
  const oldSchema = map.get(colIndex);

  // Update local cache
  map.set(colIndex, schema);

  // Write to CB (fire-and-forget)
  schemaVersion++;
  void ctx.computeBridge.updateSchema(sheetId, colIndex, columnSchemaToWire(schema), schemaVersion);

  // Emit schema changed event
  const schemaEvent: SchemaChangedEvent = {
    type: 'schema:changed',
    timestamp: Date.now(),
    sheetId,
    colIndex,
    oldSchema,
    newSchema: schema,
    source: origin === 'user' ? 'user' : 'api',
  };
  ctx.eventBus.emit(schemaEvent);
}

/**
 * Remove the schema for a column.
 * Writes to ComputeBridge (fire-and-forget) and updates local cache.
 * Emits 'schema:changed' event via the event bus.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param colIndex - Column index (0-based)
 * @param origin - Transaction origin (default: 'user')
 */
export function clearColumnSchema(
  ctx: SchemaDomainContext,
  sheetId: SheetId,
  colIndex: number,
  origin: string = 'user',
): void {
  const map = columnSchemaCache.get(sheetId);
  if (!map) return;

  const oldSchema = map.get(colIndex);
  if (!oldSchema) return; // Nothing to clear

  // Update local cache
  map.delete(colIndex);

  // Write to CB (fire-and-forget)
  schemaVersion++;
  void ctx.computeBridge.removeSchema(sheetId, colIndex, schemaVersion);

  // Emit schema changed event
  const schemaEvent: SchemaChangedEvent = {
    type: 'schema:changed',
    timestamp: Date.now(),
    sheetId,
    colIndex,
    oldSchema,
    newSchema: undefined,
    source: origin === 'user' ? 'user' : 'api',
  };
  ctx.eventBus.emit(schemaEvent);
}

/**
 * Get all schemas for a sheet.
 *
 * Reads from the local column schema cache (sync).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Map of column index to schema
 */
export function getAllColumnSchemas(sheetId: SheetId): Map<number, ColumnSchema> {
  const map = columnSchemaCache.get(sheetId);
  if (!map) return new Map();
  return new Map(map);
}

/**
 * Infer and set schemas for all columns based on data.
 * Analyzes existing cell data to determine column types automatically.
 * Uses ComputeBridge to read cell data and infer schemas.
 * Emits 'schemas:inferred' event via the event bus.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param sampleRows - Number of rows to sample (default: 100)
 * @returns Map of column index to inferred schema with confidence
 */
export async function inferAllSchemas(
  ctx: SchemaDomainContext,
  sheetId: SheetId,
  sampleRows: number = 100,
): Promise<Map<number, InferredSchema>> {
  // Query cell data from CB to determine bounds and collect column values
  // Use a large range to discover the extent of data
  const rangeData = await ctx.computeBridge.queryRange(
    sheetId,
    0,
    0,
    sampleRows,
    1000, // generous upper bound; Rust clips to actual data
  );

  if (!rangeData || !rangeData.cells || rangeData.cells.length === 0) {
    return new Map();
  }

  // Find bounds from returned cells
  let maxCol = 0;
  for (const cell of rangeData.cells) {
    if (cell.col > maxCol) maxCol = cell.col;
  }

  // Build a map of (row,col) -> value for quick lookup
  const cellMap = new Map<string, CellValue>();
  for (const cell of rangeData.cells) {
    cellMap.set(`${cell.row}:${cell.col}`, cell.value as CellValue);
  }

  // Collect values per column (skip header row 0)
  const columnData = new Map<number, CellValue[]>();
  for (let col = 0; col <= maxCol; col++) {
    const values: CellValue[] = [];
    for (let row = 1; row <= sampleRows; row++) {
      const val = cellMap.get(`${row}:${col}`);
      if (val !== undefined && val !== null) {
        values.push(val);
      }
    }
    if (values.length > 0) {
      columnData.set(col, values);
    }
  }

  // Infer schemas for each column via CB (parallel)
  const results = new Map<number, InferredSchema>();
  const inferredSchemas: Array<{ colIndex: number; schema: ColumnSchema; confidence: number }> = [];

  const inferenceResults = await Promise.all(
    Array.from(columnData).map(([colIndex, values]) =>
      ctx.computeBridge
        .schemaInferColumn(values)
        .then((wireInferred) => ({ colIndex, wireInferred })),
    ),
  );

  for (const { colIndex, wireInferred } of inferenceResults) {
    // Get column header name from row 0
    const headerVal = cellMap.get(`0:${colIndex}`);
    const headerName = typeof headerVal === 'string' ? headerVal : `Column ${colIndex + 1}`;

    // Convert wire schema to ColumnSchema
    const schema: ColumnSchema = {
      id: wireInferred.schema.id,
      name: headerName,
      type: (wireInferred.schema.type || 'any') as CellSchemaType,
      constraints: wireInferred.schema.constraints as SchemaConstraints | undefined,
      distribution: wireInferred.schema.distribution as DistributionConfig | undefined,
      description: wireInferred.schema.description,
    };

    // Convert Record<string, number> to Map<CellSchemaType, number>
    const typesFoundMap = new Map<CellSchemaType, number>();
    for (const [key, count] of Object.entries(wireInferred.typesFound)) {
      typesFoundMap.set(key as CellSchemaType, count);
    }

    const inferred: InferredSchema = {
      schema,
      confidence: wireInferred.confidence,
      sampleSize: wireInferred.sampleSize,
      typesFound: typesFoundMap,
    };

    results.set(colIndex, inferred);
    inferredSchemas.push({ colIndex, schema, confidence: wireInferred.confidence });

    // Auto-set schema if confidence is high enough (> 0.8)
    if (wireInferred.confidence > 0.8) {
      setColumnSchema(ctx, sheetId, colIndex, schema, 'infer');
    }
  }

  // Emit schemas inferred event
  const inferEvent: SchemasInferredEvent = {
    type: 'schemas:inferred',
    timestamp: Date.now(),
    sheetId,
    schemas: inferredSchemas,
  };
  ctx.eventBus.emit(inferEvent);

  return results;
}

// =============================================================================
// Range Schema Operations (Data Validation) — MIGRATED to Rust
// =============================================================================

/**
 * Get the range schema that applies to a specific cell.
 *
 * Range schema storage has been migrated to Rust via ComputeBridge.
 * This function is kept for backward compatibility with deferred app-layer files
 * that still call it synchronously. It always returns undefined since no data
 * is written to the in-memory Map anymore.
 *
 * TODO: Migrate remaining callers (CoordinatorProvider.tsx, useEditorIntegration.ts,
 * SpreadsheetGrid.tsx) to async ws.getValidation() and remove this function.
 *
 * @param _ctx - Store context (unused)
 * @param _sheetId - Sheet ID (unused)
 * @param _row - Row index (unused)
 * @param _col - Column index (unused)
 * @returns Always undefined
 */
export function getRangeSchema(
  _ctx: SchemaDomainContext,
  _sheetId: SheetId,
  _row: number,
  _col: number,
): RangeSchema | undefined {
  // Range schema storage has been migrated to Rust via ComputeBridge.
  // This function is kept for backward compatibility with 3 deferred app-layer files
  // that still call it synchronously. It always returns undefined since no data
  // is written to the in-memory Map anymore.
  // TODO: Migrate remaining callers (CoordinatorProvider.tsx, useEditorIntegration.ts,
  // SpreadsheetGrid.tsx) to async ws.getValidation() and remove this function.
  return undefined;
}

// =============================================================================
// Cell Value Validation (Data Validation Enforcement)
// =============================================================================

/**
 * Result of validating a cell value against its schema.
 * Used by editor commit coordination to enforce data validation.
 */
export interface CellValidationResult {
  /** Whether the value is valid */
  valid: boolean;
  /** Error message if invalid */
  errorMessage?: string;
  /** Error title (for dialog display) */
  errorTitle?: string;
  /** Enforcement level determines UI behavior */
  enforcement: EnforcementLevel;
}

/**
 * Validate a cell value against its schema constraints.
 *
 * Since range schema storage has been migrated to Rust via ComputeBridge,
 * getRangeSchema() always returns undefined, so this function always returns null.
 * Kept for backward compatibility with CoordinatorProvider.tsx.
 *
 * TODO: Migrate CoordinatorProvider.tsx to use ws.validateCellValueInDoc() directly
 * and remove this function.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @param _value - Value to validate (unused — always returns null)
 * @param _formulaEvaluator - Optional callback (unused — always returns null)
 * @returns Always null (no local range schema data)
 */
export async function validateCellValue(
  ctx: SchemaDomainContext,
  sheetId: SheetId,
  row: number,
  col: number,
  _value: string,
  _formulaEvaluator?: (formula: string, context: unknown) => unknown,
): Promise<CellValidationResult | null> {
  // getRangeSchema always returns undefined since range schema storage
  // has been migrated to Rust. This means validateCellValue always returns null.
  const rangeSchema = getRangeSchema(ctx, sheetId, row, col);
  if (!rangeSchema) {
    return null;
  }
  // Unreachable — kept only so the return type is formally satisfied.
  return null;
}
