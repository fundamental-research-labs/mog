/**
 * Cell Identity Model Types
 *
 * This module defines the types for the cell identity model, which replaces
 * A1-style positional references with stable cell identity references.
 *
 * Key insight: In the identity model, cell movement is tracked by updating
 * position data, not by rewriting formula strings. This eliminates O(n)
 * formula rewrites on structure changes and makes concurrent structure
 * changes compose correctly under CRDT.
 *
 * This is the same approach Google Sheets uses internally.
 *
 */

import type { SheetId } from '../sheet-id';

// =============================================================================
// Cell Identity Types
// =============================================================================

/**
 * Stable cell identifier - never changes even when cell moves.
 *
 * We use UUID v7 (time-sortable) for:
 * - Uniqueness across clients (no coordination needed)
 * - Time-sortability for debugging
 * - Compact string representation
 */
declare const __cellId: unique symbol;
export type CellId = string & { readonly [__cellId]: true };

/** Construct a branded CellId from a raw string. */
export function cellId(id: string): CellId {
  return id as CellId;
}

/** Wire-seam alias for branding raw CellId values from storage/bridge payloads. */
export const toCellId = cellId;

// =============================================================================
// Row Identity Types
// =============================================================================

/**
 * Stable row identifier - never changes even when rows are inserted/deleted.
 *
 * Follows the same pattern as CellId:
 * - UUID v7 (time-sortable)
 * - Position stored in RowData, not as key
 * - Enables CRDT-safe row format storage
 *
 */
declare const __rowId: unique symbol;
export type RowId = string & { readonly [__rowId]: true };

/** Construct a branded RowId from a raw string. */
export function rowId(id: string): RowId {
  return id as RowId;
}

/** Wire-seam alias for branding raw RowId values from storage/bridge payloads. */
export const toRowId = rowId;

/**
 * Row data stored in the rows map.
 *
 * Contains the current position of the row. Position is mutable and updated
 * during structure changes (insert/delete rows). The RowId key is stable.
 *
 * Future extensibility: hidden, groupLevel, outlineState, etc.
 */
export interface RowData {
  /** Current zero-based row position (mutable on structure changes) */
  position: number;
}

// =============================================================================
// Column Identity Types
// =============================================================================

/**
 * Stable column identifier - never changes even when columns are inserted/deleted.
 *
 * Follows the same pattern as CellId:
 * - UUID v7 (time-sortable)
 * - Position stored in ColData, not as key
 * - Enables CRDT-safe column format storage
 *
 */
declare const __colId: unique symbol;
export type ColId = string & { readonly [__colId]: true };

/** Construct a branded ColId from a raw string. */
export function colId(id: string): ColId {
  return id as ColId;
}

/** Wire-seam alias for branding raw ColId values from storage/bridge payloads. */
export const toColId = colId;

/**
 * Column data stored in the cols map.
 *
 * Contains the current position of the column. Position is mutable and updated
 * during structure changes (insert/delete columns). The ColId key is stable.
 *
 * Future extensibility: hidden, groupLevel, outlineState, etc.
 */
export interface ColData {
  /** Current zero-based column position (mutable on structure changes) */
  position: number;
}

// =============================================================================
// Formula Reference Types (for formula storage)
// =============================================================================

/**
 * Reference to a cell by identity (for formula storage).
 *
 * Note: These types are prefixed with `Identity` to distinguish them from the
 * existing position-based `CellRef`/`RangeRef` in `range-ref.ts` which are
 * used for data validation, copy/paste, and other positional operations.
 *
 * The absolute flags preserve user intent for A1 display:
 * - $A$1 = both absolute (display stays fixed even if cell moves)
 * - $A1 = column absolute (for column references in formulas)
 * - A$1 = row absolute (for row references in formulas)
 * - A1 = both relative (display adjusts when viewing formula moves)
 */
export interface IdentityCellRef {
  type: 'cell';
  /** The stable cell identity */
  id: CellId;
  /** True for $1 syntax (row absolute for display) */
  rowAbsolute: boolean;
  /** True for $A syntax (column absolute for display) */
  colAbsolute: boolean;
}

/**
 * Reference to a range by corner cell identities (for formula storage).
 *
 * Ranges are defined by their corner cells. When rows/columns are inserted
 * between the corners, the range automatically expands because the corner
 * cells' positions change.
 */
export interface IdentityRangeRef {
  type: 'range';
  /** Start cell (top-left corner) identity */
  startId: CellId;
  /** End cell (bottom-right corner) identity */
  endId: CellId;
  /** Absolute flags for start cell display */
  startRowAbsolute: boolean;
  startColAbsolute: boolean;
  /** Absolute flags for end cell display */
  endRowAbsolute: boolean;
  endColAbsolute: boolean;
}

/**
 * Reference to a rectangular range by sheet plus row/column identities.
 *
 * This is used when the formula parser can preserve a range in terms of durable
 * row and column IDs instead of corner cell IDs.
 */
export interface IdentityRectRangeRef {
  type: 'rectRange';
  /** Sheet that owns the row and column identities */
  sheetId: SheetId;
  /** Start row identity */
  startRowId: RowId;
  /** Start column identity */
  startColId: ColId;
  /** End row identity */
  endRowId: RowId;
  /** End column identity */
  endColId: ColId;
  /** Absolute flags for start cell display */
  startRowAbsolute: boolean;
  startColAbsolute: boolean;
  /** Absolute flags for end cell display */
  endRowAbsolute: boolean;
  endColAbsolute: boolean;
}

/**
 * Reference to an entire row by row identity.
 */
export interface IdentityFullRowRef {
  type: 'fullRow';
  /** Stable row identity */
  rowId: RowId;
  /** True for absolute row display */
  absolute: boolean;
}

/**
 * Reference to a row span by row identities.
 */
export interface IdentityRowRangeRef {
  type: 'rowRange';
  /** Start row identity */
  startRowId: RowId;
  /** End row identity */
  endRowId: RowId;
  /** Absolute flag for start row display */
  startAbsolute: boolean;
  /** Absolute flag for end row display */
  endAbsolute: boolean;
}

/**
 * Reference to an entire column by column identity.
 */
export interface IdentityFullColRef {
  type: 'fullCol';
  /** Stable column identity */
  colId: ColId;
  /** True for absolute column display */
  absolute: boolean;
}

/**
 * Reference to a column span by column identities.
 */
export interface IdentityColRangeRef {
  type: 'colRange';
  /** Start column identity */
  startColId: ColId;
  /** End column identity */
  endColId: ColId;
  /** Absolute flag for start column display */
  startAbsolute: boolean;
  /** Absolute flag for end column display */
  endAbsolute: boolean;
}

/**
 * Union of identity-based formula references.
 */
export type IdentityFormulaRef =
  | IdentityCellRef
  | IdentityRangeRef
  | IdentityRectRangeRef
  | IdentityFullRowRef
  | IdentityRowRangeRef
  | IdentityFullColRef
  | IdentityColRangeRef;

// =============================================================================
// Range Schema Types (for CRDT-safe data validation ranges)
// =============================================================================

/**
 * Reference to a range by corner cell identities for schema/validation purposes.
 *
 * Unlike IdentityRangeRef (used in formulas), this type:
 * - Has no absolute flags (not needed for validation ranges)
 * - Supports cross-sheet references via optional sheetId
 * - Is designed for RangeSchema.ranges and enumSource constraints
 *
 * Why this exists:
 * RangeSchema previously stored A1 strings ("A1:B10") which have the same CRDT
 * conflict issue as position-based formula refs. By using CellId corner refs,
 * concurrent structure changes compose correctly.
 *
 * @example
 * // Schema applies to A1:C10
 * const ref: IdentityRangeSchemaRef = {
 *   startId: 'abc-123...',  // CellId of A1
 *   endId: 'def-456...',    // CellId of C10
 * };
 *
 * @example
 * // enumSource from another sheet
 * const ref: IdentityRangeSchemaRef = {
 *   sheetId: 'sheet-2-uuid',
 *   startId: 'abc-123...',
 *   endId: 'def-456...',
 * };
 */
export interface IdentityRangeSchemaRef {
  /**
   * Optional target sheet ID for cross-sheet references (SheetId).
   * - undefined: same sheet as the schema (common case)
   * - string: specific sheet ID for cross-sheet enumSource
   */
  sheetId?: string;

  /** Cell identifier string (CellId) of the top-left corner cell */
  startId: string;

  /** Cell identifier string (CellId) of the bottom-right corner cell */
  endId: string;
}

// =============================================================================
// CellIdRange Types (for CRDT-safe ranges in Charts, Tables, Grouping)
// =============================================================================

/**
 * A range defined by corner cell identities.
 *
 * This is the universal type for CRDT-safe range references used by:
 * - Charts (data ranges, anchor positions)
 * - Tables (table extent)
 * - Grouping (group extent)
 *
 * Unlike position-based ranges, CellIdRange automatically handles:
 * - Concurrent structure changes (insert/delete rows/cols)
 * - Range expansion when cells inserted between corners
 * - Correct CRDT composition under concurrent edits
 *
 * Position resolution happens at render/extraction time via GridIndex.
 *
 * @example
 * // Chart data range A1:D10
 * const range: CellIdRange = {
 *   topLeftCellId: 'abc-123...',     // CellId of A1
 *   bottomRightCellId: 'def-456...'  // CellId of D10
 * };
 *
 * // After user inserts column at B:
 * // - CellIds unchanged
 * // - But A1 is still at (0,0), D10 is now at (9,4)
 * // - Range automatically covers A1:E10
 */
export interface CellIdRange {
  /** Cell identifier string (CellId) of the top-left corner cell */
  topLeftCellId: string;

  /** Cell identifier string (CellId) of the bottom-right corner cell */
  bottomRightCellId: string;
}

// =============================================================================
// Merged Region Types (for CRDT-safe merge cells)
// =============================================================================

/**
 * A merged region defined by corner cell identities.
 *
 * This follows the same pattern as IdentityRangeRef - merges are defined by
 * CellId references to corner cells rather than position coordinates. This
 * ensures concurrent structure changes (insert/delete rows/cols) compose
 * correctly under CRDT.
 *
 * Position-based merges have the same problem as position-based formula refs:
 * ```
 * User A: Creates merge at A1:B2
 * User B: Inserts column at A (concurrent)
 *
 * Position-based: Yjs merges two incompatible coordinate sets → wrong result
 * CellId-based: Both position shifts apply, CellIds stable → correct result
 * ```
 *
 * @example
 * // User merges A1:C3
 * const merge: IdentityMergedRegion = {
 *   topLeftId: 'abc-123...',    // CellId of A1
 *   bottomRightId: 'def-456...' // CellId of C3
 * };
 * // After inserting column at B, the CellIds are unchanged
 * // but their positions have shifted, so the merge now covers A1:D3
 */
export interface IdentityMergedRegion {
  /** Origin cell - contains the merged value and is the "owner" of the merge (CellId) */
  topLeftId: string;

  /** Extent marker - defines bottom-right boundary of the merge (CellId) */
  bottomRightId: string;
}

// =============================================================================
// Formula Storage Types
// =============================================================================

/**
 * Formula stored with identity references.
 *
 * The template uses numbered placeholders that are filled in by refs.
 *
 * @example
 * User types: =SUM(A1:B10)+C1*2
 * Stored as:
 * {
 *   template: "SUM({0})+{1}*2",
 *   refs: [
 *     { type: 'range', startId: 'abc...', endId: 'def...' },
 *     { type: 'cell', id: 'ghi...' }
 *   ]
 * }
 *
 * When displaying, we resolve each ref to its current A1 position.
 */
export interface IdentityFormula {
  /**
   * Template with numbered placeholders for refs.
   * Example: "SUM({0}:{1})+{2}*2"
   *
   * The template preserves the formula structure (function names, operators,
   * literals) while placeholders mark where cell/range references go.
   */
  template: string;

  /**
   * Ordered refs that fill template placeholders.
   * refs[0] fills {0}, refs[1] fills {1}, etc.
   */
  refs: IdentityFormulaRef[];
}

// =============================================================================
// Interface Contracts (for dependency injection in parallel phases)
// =============================================================================

/**
 * Interface for formula conversion between A1 and identity formats.
 *
 * This interface enables Import/Export to be developed in parallel
 * with the Formula Parser by mocking this interface.
 */
export interface IFormulaConverter {
  /**
   * Convert A1-style formula to identity formula.
   * Called when user types a formula or imports from XLSX.
   *
   * @param a1Formula - Formula string with A1 references (e.g., "=SUM(A1:B10)")
   * @param sheetId - Current sheet for resolving relative references
   * @returns Identity formula with cell ID references
   */
  toIdentity(a1Formula: string, sheetId: SheetId): IdentityFormula;

  /**
   * Convert identity formula back to A1-style string.
   * Called for display in formula bar and export to XLSX.
   *
   * @param formula - Identity formula with cell ID references
   * @returns A1-style formula string (e.g., "=SUM(A1:B10)")
   */
  toA1(formula: IdentityFormula): string;
}
