/**
 * Schema & Validation Events
 *
 * Event types for schema and data validation.
 */

import type { CellValue } from '@mog/types-core';
import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type {
  CellSchemaType,
  ColumnSchema,
  RangeSchema,
  SchemaValidationError,
} from '@mog/types-commands/schema';

export interface ValidationFailedEvent extends BaseEvent {
  type: 'validation:failed';
  sheetId: string;
  row: number;
  col: number;
  value: CellValue | null;
  schema: ColumnSchema;
  errors: SchemaValidationError[];
}

export interface ValidationPassedEvent extends BaseEvent {
  type: 'validation:passed';
  sheetId: string;
  row: number;
  col: number;
  value: CellValue | null;
  coercedValue?: CellValue;
  inferredType: CellSchemaType;
}

export interface SchemaChangedEvent extends BaseEvent {
  type: 'schema:changed';
  sheetId: string;
  colIndex: number;
  oldSchema: ColumnSchema | undefined;
  newSchema: ColumnSchema | undefined;
  source: StructureChangeSource;
}

export interface SchemasInferredEvent extends BaseEvent {
  type: 'schemas:inferred';
  sheetId: string;
  schemas: Array<{
    colIndex: number;
    schema: ColumnSchema;
    confidence: number;
  }>;
}

export interface RangeSchemaCreatedEvent extends BaseEvent {
  type: 'range-schema:created';
  sheetId: string;
  schema: RangeSchema;
  source: StructureChangeSource;
}

export interface RangeSchemaUpdatedEvent extends BaseEvent {
  type: 'range-schema:updated';
  sheetId: string;
  schemaId: string;
  oldSchema: RangeSchema;
  newSchema: RangeSchema;
  source: StructureChangeSource;
}

export interface RangeSchemaDeletedEvent extends BaseEvent {
  type: 'range-schema:deleted';
  sheetId: string;
  schemaId: string;
  schema: RangeSchema;
  source: StructureChangeSource;
}

/**
 * Emitted after Rust recalc produces validation annotations.
 * Replaces direct Yjs property writes — UI consumes this event
 * to display validation error indicators on cells.
 */
export interface ValidationRecalcAnnotationsEvent extends BaseEvent {
  type: 'validation:recalc-annotations';
  annotations: Array<{
    cellId: string;
    sheetId: string;
    row: number;
    column: number;
    errors: Array<{
      rule: string;
      message: string;
      severity: 'error' | 'warning';
    }>;
  }>;
}

export type ValidationEvent =
  | ValidationFailedEvent
  | ValidationPassedEvent
  | SchemaChangedEvent
  | SchemasInferredEvent
  | RangeSchemaCreatedEvent
  | RangeSchemaUpdatedEvent
  | RangeSchemaDeletedEvent
  | ValidationRecalcAnnotationsEvent;
