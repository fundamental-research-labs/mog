/**
 * Cell Data Schema - SINGLE SOURCE OF TRUTH
 *
 * Defines the complete cell data structure with:
 * - Short names (for Yjs CRDT storage efficiency: 'r', 'f', 'c', etc.)
 * - Long names (for API/code readability: 'raw', 'formula', 'computed', etc.)
 * - Copy strategies (for clipboard operations)
 * - Required/optional fields
 *
 * This schema unifies multiple cell data types across the codebase:
 * - SerializedCellData (CRDT storage with short names)
 * - StoreCellData (runtime representation with long names)
 * - ClipboardCellData (clipboard operations)
 * - DiffCellData (removed — was in versioning.ts, package deleted)
 *
 * NAME MAPPING RATIONALE:
 * Short names reduce CRDT operation size and storage.
 * Example: 'r' vs 'raw' saves ~66% per field access.
 * For documents with 100K cells, this is significant.
 *
 * @see docs/architecture/cell-identity.md
 */

import type { Schema } from './schema-types';

// =============================================================================
// Cell Data Schema Definition
// =============================================================================

/**
 * SINGLE SOURCE OF TRUTH for Cell data structure.
 *
 * Defines both short names (for Yjs storage) and long names (for API).
 *
 * FIELD CATEGORIES:
 *
 * 1. Identity Fields (id, row, col)
 *    - Required for all cells
 *    - Skip on copy (new ID/position assigned)
 *
 * 2. Value Fields (raw, formula, identityFormula, computed)
 *    - Core cell content
 *    - raw: User-entered value (CellRawValue)
 *    - formula: A1-style formula string for display/export
 *    - identityFormula: Parsed formula with CellId references (stable)
 *    - computed: Evaluated result for formula cells
 *
 * 3. Metadata Fields (note, hyperlink)
 *    - Optional cell annotations
 *    - Deep copied on clipboard operations
 *
 * 4. Spill Fields (spillRange, spillAnchor, isCSE)
 *    - Array formula support
 *    - Skip on copy (recomputed after paste)
 */
export const CELL_DATA_SCHEMA = {
  // ===========================================================================
  // Identity Fields
  // ===========================================================================

  /**
   * Stable cell identity (UUID v7).
   * Never changes even when cell moves.
   * Primary key for cell storage.
   */
  id: {
    type: 'primitive',
    shortName: 'id', // Same (short enough)
    required: true,
    copy: 'skip', // New ID on copy
    lazyInit: false,
  },

  /**
   * Current row position (0-indexed).
   * Mutable on structure changes (insert/delete rows).
   */
  row: {
    type: 'primitive',
    shortName: 'row', // Same (metadata, not in CRDT ops frequently)
    required: true,
    copy: 'skip', // New position on copy
    lazyInit: false,
  },

  /**
   * Current column position (0-indexed).
   * Mutable on structure changes (insert/delete columns).
   */
  col: {
    type: 'primitive',
    shortName: 'col', // Same
    required: true,
    copy: 'skip', // New position on copy
    lazyInit: false,
  },

  // ===========================================================================
  // Value Fields
  // ===========================================================================

  /**
   * Raw value entered by user (CellRawValue).
   * Can be:
   * - Primitive: string | number | boolean | null
   * - RichText: Array<RichTextSegment>
   * - Formula string (starts with '=')
   */
  raw: {
    type: 'primitive',
    shortName: 'r',
    required: false, // Empty cells have no raw
    copy: 'deep',
    lazyInit: false,
  },

  /**
   * A1-style formula string (without '=' prefix).
   * Used for:
   * - Formula bar display
   * - Calculator evaluation (backward compatible)
   * - Export to Excel/CSV
   *
   * Example: "SUM(A1:A10)" (not "=SUM(A1:A10)")
   */
  formula: {
    type: 'primitive',
    shortName: 'f',
    required: false,
    copy: 'deep', // Formulas need adjustment on paste
    lazyInit: false,
  },

  /**
   * Parsed formula with identity references (CellIds).
   * This is the source of truth for formula references.
   * A1 string is derived from this on demand.
   *
   * Using CellIds instead of A1 means formulas are stable:
   * - Insert/delete rows/cols don't break formulas
   * - CRDT merges work correctly
   *
   * @see docs/architecture/cell-identity.md
   */
  identityFormula: {
    type: 'primitive',
    shortName: 'idf',
    required: false,
    copy: 'deep', // CellId references need remapping on paste
    lazyInit: false,
  },

  /**
   * Computed value after formula evaluation.
   * Only set if cell has a formula.
   *
   * For non-formula cells, use rawToCellValue(raw).
   *
   * INVARIANT: For formula cells, ALWAYS use computed.
   * null is a valid result (empty reference, IF(FALSE,1), etc.)
   */
  computed: {
    type: 'primitive',
    shortName: 'c',
    required: false,
    copy: 'skip', // Recomputed after paste, not copied
    lazyInit: false,
  },

  // ===========================================================================
  // Metadata Fields
  // ===========================================================================

  /**
   * Cell note/comment text.
   * Plain string (not rich text).
   * Displayed as tooltip or comment indicator.
   */
  note: {
    type: 'primitive',
    shortName: 'n',
    required: false,
    copy: 'deep',
    lazyInit: false,
  },

  /**
   * Hyperlink URL.
   * Opens when cell is clicked (with modifier key).
   */
  hyperlink: {
    type: 'primitive',
    shortName: 'h',
    required: false,
    copy: 'deep',
    lazyInit: false,
  },

  // ===========================================================================
  // Spill Fields (Array Formulas - Stream AF)
  // ===========================================================================

  /**
   * For spill anchor cells: dimensions of the spill range.
   * { rows: number, cols: number } where both >= 1.
   *
   * Only present on the cell containing the array formula.
   * The formula result "spills" into adjacent cells.
   */
  spillRange: {
    type: 'primitive',
    shortName: 'spillRange', // Same (not frequently accessed)
    required: false,
    copy: 'skip', // Recomputed based on formula result
    lazyInit: false,
  },

  /**
   * For spill member cells: CellId of the anchor cell.
   * Points back to the cell owning the array formula.
   *
   * Used for:
   * - Blocking edits on spill cells
   * - Finding formula when clicking spill cell
   * - Clearing old spill when result size changes
   */
  spillAnchor: {
    type: 'primitive',
    shortName: 'spillAnchor', // Same
    required: false,
    copy: 'skip', // Recomputed - spill structure rebuilt on paste
    lazyInit: false,
  },

  /**
   * True if this is a legacy CSE (Ctrl+Shift+Enter) array formula.
   * CSE formulas have fixed size and show {=formula} in formula bar.
   * Only present on anchor cells when isCSE is true.
   */
  isCSE: {
    type: 'primitive',
    shortName: 'isCSE', // Same
    required: false,
    copy: 'deep', // CSE status is part of formula semantics
    lazyInit: false,
  },
} as const satisfies Schema;

// =============================================================================
// Name Mapping Utilities
// =============================================================================

/**
 * Map from short names (Yjs storage) to long names (API).
 * Example: { 'r': 'raw', 'f': 'formula', 'c': 'computed', ... }
 */
export const CELL_SHORT_TO_LONG: Record<string, string> = {};

/**
 * Map from long names (API) to short names (Yjs storage).
 * Example: { 'raw': 'r', 'formula': 'f', 'computed': 'c', ... }
 */
export const CELL_LONG_TO_SHORT: Record<string, string> = {};

// Build the mappings from schema
for (const [longName, def] of Object.entries(CELL_DATA_SCHEMA)) {
  const shortName = (def as { shortName: string }).shortName || longName;
  CELL_SHORT_TO_LONG[shortName] = longName;
  CELL_LONG_TO_SHORT[longName] = shortName;
}

/**
 * All cell field names (long form) from the schema.
 * Useful for iterating over all fields.
 */
export const CELL_FIELD_NAMES = Object.keys(CELL_DATA_SCHEMA) as Array<
  keyof typeof CELL_DATA_SCHEMA
>;

/**
 * Fields that should be copied during clipboard operations.
 * Excludes: id, row, col (position-dependent), computed/spill (recomputed).
 */
export const CELL_COPYABLE_FIELDS = CELL_FIELD_NAMES.filter(
  (name) => CELL_DATA_SCHEMA[name].copy === 'deep',
);
