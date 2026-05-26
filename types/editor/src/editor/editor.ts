/**
 * Cell Editor Types
 *
 * Types for determining the appropriate editor/picker for a cell based on its schema.
 * Used by the editor state machine to render the correct input control.
 *
 * @module contracts/editor
 */

import type { CellSchema } from '@mog/types-commands/schema';

// ============================================================================
// Cell Editor Type
// ============================================================================

/**
 * Types of cell editors/pickers that can be rendered.
 *
 * The editor type determines what input control to show when a cell is edited.
 * This is resolved from the cell's schema by resolveEditorType() in compute-schema (Rust).
 */
export type CellEditorType =
  | 'text' // Default: standard text input
  | 'dropdown' // Enum constraint: show dropdown list picker
  | 'date' // Date type: show date picker
  | 'time' // Time semantic type: show time picker
  | 'color' // Color semantic type: show color picker
  | 'checkbox' // Boolean type: show checkbox
  | 'slider' // Number with min/max: show slider
  | 'calculator'; // Number type: show calculator

/**
 * Context provided to the editor for schema-aware editing.
 *
 * This is stored in the editor machine's context and used for:
 * - Determining which picker to render
 * - Validating input on commit
 * - Providing dropdown items for enum constraints
 */
export interface CellEditorContext {
  /** The resolved editor type for this cell */
  editorType: CellEditorType;

  /** The cell's schema (if any) for validation/dropdown items */
  cellSchema: CellSchema | null;

  /** Resolved enum items for dropdown (from static enum or enumSource) */
  enumItems: unknown[] | null;
}

// ============================================================================
// Editor Type Resolution Input
// ============================================================================

/**
 * Input for resolving editor type from schema.
 *
 * The resolver function takes a cell's schema and optional context
 * to determine the appropriate editor type.
 */
export interface EditorTypeResolutionInput {
  /** The cell's schema (undefined if no schema applied) */
  schema?: CellSchema;

  /**
   * Resolved enum items for enumSource constraints.
   * Must be provided externally since enumSource requires cell lookups.
   */
  resolvedEnumItems?: unknown[];
}

/**
 * Result of editor type resolution.
 */
export interface EditorTypeResolutionResult {
  /** The resolved editor type */
  editorType: CellEditorType;

  /** Enum items to display (for dropdown type) */
  enumItems: unknown[] | null;

  /** Whether the schema requires validation on commit */
  requiresValidation: boolean;
}
