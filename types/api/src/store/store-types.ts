// TODO: Migrate SheetMaps floating object references to use containerId-aware types.

/**
 * Store Types - Type definitions for cell storage.
 *
 * These types define the internal storage format for cells, sheets, and filters.
 * They are used by domain modules and bridge the gap between the contracts API
 * and the storage implementation.
 *
 * Cell Identity Model:
 * - Cells are keyed by stable CellId (UUID), not position
 * - Position (row, col) is stored IN the cell data, not AS the key
 * - Grid index maps position -> CellId for O(1) lookup
 *
 * NOTE: These types use standard Map/Array instead of Yjs CRDT types.
 * The storage layer is responsible for providing Map-compatible containers.
 *
 */

import type {
  CellId,
  ColData,
  ColId,
  IdentityFormula,
  IdentityMergedRegion,
  RowData,
  RowId,
} from '@mog/types-core/cell-identity';
import type { FormulaA1 } from '@mog/types-core/formula-string';
import type { CellFormat, CellProperties, CellRawValue, CellValue, SheetId } from '@mog/types-core';
import type { ColumnSchema, RangeSchema } from '@mog/types-commands/schema';
import type { FilterType } from '@mog/types-data/data/filter';
import type { StoredSlicerConfig } from '@mog/types-data/data/slicers';
import type { TableConfig } from '@mog/types-data/data/tables';
import type { Comment } from '@mog-sdk/types-document/document/comments';
import type { FormControl } from '@mog/types-editor/editor/form-controls';
import type {
  FloatingObject,
  FloatingObjectGroup,
} from '@mog/types-objects/objects/floating-objects';

// Charts are now stored as FloatingObject (type: "chart") in the compute core.
// The charts map uses the same FloatingObject type from contracts/objects.

// =============================================================================
// Sheet Metadata (Yjs internal storage)
// =============================================================================

/**
 * Cached used range for O(1) Ctrl+End navigation.
 * Stores the bounding box end point of all non-empty cells.
 */
export interface UsedRange {
  /** Maximum row index with data (0-indexed) */
  endRow: number;
  /** Maximum column index with data (0-indexed) */
  endCol: number;
}

/**
 * Sheet metadata stored in Yjs.
 * Contains dimensions, frozen panes, and display properties.
 */
export interface SheetMeta {
  id: SheetId;
  name: string;
  /** Default row height for new rows in pixels */
  defaultRowHeight: number;
  /** Default column width for new columns in pixels */
  defaultColWidth: number;
  /** Number of frozen rows (always visible) */
  frozenRows: number;
  /** Number of frozen columns (always visible) */
  frozenCols: number;
  /** Tab color in hex format (e.g., "#4285f4"), null for default */
  tabColor?: string | null;
  /** Whether the sheet is hidden */
  hidden?: boolean;
  /**
   * Cached used range for O(1) Ctrl+End navigation.
   * Updated incrementally on cell writes. May over-estimate on deletions.
   */
  usedRange?: UsedRange | null;
}

// =============================================================================
// Cell Data Types (Identity Model)
// =============================================================================

/**
 * Internal cell data for Yjs storage (Cell Identity Model).
 *
 * Key insight: Position is stored IN the cell, not AS the key.
 * This enables O(1) position updates on insert/delete row/col
 * without touching formula strings or dependency graph keys.
 *
 * NOTE: The external API `CellData` in contracts/src/core.ts is UNCHANGED.
 * This type is for internal Yjs storage only. Conversion happens at API boundaries.
 */
/**
 * Write-side subset of StoreCellData.
 *
 * This is the shape callers pass to `Cells.set()`. It contains only the fields
 * that make sense as *input* (no id/row/col/note/hyperlink/spill metadata).
 * Formally derived from StoreCellData so the two stay in sync automatically.
 */
export type CellWriteData = Pick<StoreCellData, 'raw' | 'formula' | 'identityFormula' | 'computed'>;

export interface StoreCellData {
  /** Stable cell identity - never changes even when cell moves */
  id: CellId;

  /** Current row position (mutable on structure changes) */
  row: number;

  /** Current column position (mutable on structure changes) */
  col: number;

  /**
   * Raw value entered by user (CellRawValue).
   * Can be a formula string, literal primitive, or RichText array.
   * Rich text is only valid for literal values, not formula results.
   * Use rawToCellValue() to convert to CellValue when needed.
   */
  raw: CellRawValue;

  /**
   * A1-style formula string with '=' prefix (FormulaA1).
   * Used for formula bar display and calculator evaluation.
   * This is the backward-compatible formula field.
   */
  formula?: FormulaA1;

  /**
   * Parsed formula with identity references.
   * Used for stable formula storage that survives structure changes.
   * When populated, this is the source of truth for formula references.
   */
  identityFormula?: IdentityFormula;

  /** Computed value after formula evaluation (only set if raw is a formula) */
  computed?: CellValue;

  /** Cell note/comment (optional) */
  note?: string;

  /** Hyperlink URL (optional) */
  hyperlink?: string;

  // ===========================================================================
  // Spill Fields (Stream AF: Array Formulas)
  // ===========================================================================

  /**
   * For spill anchor cells: the dimensions of the spill range.
   * { rows, cols } where rows >= 1 and cols >= 1.
   */
  spillRange?: { rows: number; cols: number };

  /**
   * For spill member cells: CellId of the anchor cell containing the formula.
   */
  spillAnchor?: CellId;

  /**
   * True if this is a legacy CSE (Ctrl+Shift+Enter) array formula.
   */
  isCSE?: boolean;

  // ===========================================================================
  // Region Metadata (D4: projection-family unification)
  // ===========================================================================

  /**
   * Region-membership shape for cells that belong to a non-trivial region
   * (CSE array, dynamic-array spill, Data Table; future pivot / table
   * column / etc.). `null` for plain cells.
   *
   * Surfaced via the kernel API `cells.getData(...)` from the same Rust
   * chokepoint (`mirror.cell_render_at`) used by `get_active_cell`. The
   * formula bar's brace policy is a per-`region.kind` switch (D5).
   *
   */
  region?: RegionMeta | null;
}

// =============================================================================
// Region Metadata (Stream D3/D4: projection-family unification)
// =============================================================================

/**
 * Region kind discriminant — string union matching Rust's
 * `serde(rename_all = "camelCase")` serialization of `enum RegionKind`.
 *
 * - `arraySpill` — modern dynamic-array spill (e.g. `=SEQUENCE(5)`).
 *   The formula bar does NOT brace-wrap members.
 * - `cseArray` — legacy Ctrl+Shift+Enter array formula. Formula bar
 *   brace-wraps (`{=…}`).
 * - `dataTable` — XLSX `<f t="dataTable">`. Formula bar brace-wraps
 *   (`{=TABLE(…)}`).
 *
 * Mirrors `kernel/src/bridges/compute/types.ts::RegionKind` and Rust's
 * `snapshot_types::properties::RegionKind`. Re-exported from the bridge
 * to keep the wire types in one place.
 */
export type RegionKind = 'arraySpill' | 'cseArray' | 'dataTable';

/**
 * Region rectangle dimensions in cells. Together with `anchorRow` /
 * `anchorCol` describes the full region rectangle.
 */
export interface RegionBounds {
  rows: number;
  cols: number;
}

/**
 * Region membership shape carried on `StoreCellData.region`.
 *
 * `isAnchor` distinguishes the formula-owning cell (CSE anchor / Data
 * Table master) from members. **No `source` field** — formula text lives
 * on `StoreCellData.formula`; brace policy is a per-`kind` switch.
 */
export interface RegionMeta {
  kind: RegionKind;
  isAnchor: boolean;
  anchorRow: number;
  anchorCol: number;
  bounds: RegionBounds;
}

/**
 * Serialized cell data for Yjs storage.
 * Uses short keys for compact CRDT storage.
 *
 * NOTE: The DiffCellData type (previously in contracts/src/versioning.ts)
 * was removed when the versioning package was deleted.
 */
export interface SerializedCellData {
  /** Stable cell identity */
  id: CellId;
  /** Row position */
  row: number;
  /** Column position */
  col: number;
  /**
   * Raw value (CellRawValue).
   * Can be a primitive (string, number, boolean, null) or RichText array.
   * Rich text is only valid for literal values, not formula results.
   * Use isRichText() from @mog-sdk/contracts to discriminate.
   * Use rawToCellValue() to convert to CellValue when needed.
   */
  r: CellRawValue;
  /** A1-style formula string without '=' prefix (backward compatible) */
  f?: string;
  /** Parsed identity formula */
  idf?: IdentityFormula;
  /** Computed value (omit if same as raw) */
  c?: CellValue;
  /** Note (omit if empty) */
  n?: string;
  /** Hyperlink URL (omit if none) */
  h?: string;

  // ===========================================================================
  // Spill Fields (Stream AF: Array Formulas)
  // ===========================================================================

  /**
   * For spill anchor cells: the dimensions of the spill range.
   * { rows, cols } where rows >= 1 and cols >= 1.
   * Only present on the cell containing the array formula.
   */
  spillRange?: { rows: number; cols: number };

  /**
   * For spill member cells: CellId of the anchor cell containing the formula.
   * Points back to the cell that owns this spill range.
   * Used for:
   * - Determining if editing this cell should be blocked
   * - Finding the formula when clicking a spill cell
   * - Clearing old spill when anchor formula result changes size
   */
  spillAnchor?: CellId;

  /**
   * True if this is a legacy CSE (Ctrl+Shift+Enter) array formula.
   * CSE formulas have fixed size and show {=formula} in the formula bar.
   * Only present on anchor cells when isCSE is true.
   */
  isCSE?: boolean;
}

// =============================================================================
// Filter State (Yjs Storage) - Layer 0: Filter State Foundation (Cell Identity)
// =============================================================================

/**
 * Yjs-compatible filter state for storage (Cell Identity Model).
 *
 * ARCHITECTURE: Stores CellIds for range corners and column filter keys,
 * NOT position-based row/col numbers. This follows the same pattern as:
 * - IdentityRangeRef (formulas)
 * - IdentityRangeSchemaRef (data validation)
 * - IdentityMergedRegion (merged cells)
 *
 * Why CellId-based?
 * - Survives row/col insert/delete (positions change, CellIds stable)
 * - CRDT-safe for concurrent structure changes
 * - Matches the Cell Identity Model used throughout the codebase
 *
 * The filter-operations module handles conversion between FilterState and StoredFilterState.
 */
export interface StoredFilterState {
  /** Unique filter identifier (UUID v7) */
  id: string;

  /** Filter type: 'autoFilter' | 'tableFilter' | 'advancedFilter' */
  type: FilterType;

  // ===========================================================================
  // Range Definition (Cell Identity Model)
  // ===========================================================================

  /**
   * CellId of the header row, first column (top-left of header).
   * Example: If filter is on A1:C10, this is the CellId of A1.
   */
  headerStartCellId: CellId;

  /**
   * CellId of the header row, last column (top-right of header).
   * Example: If filter is on A1:C10, this is the CellId of C1.
   */
  headerEndCellId: CellId;

  /**
   * CellId of the last data row, first column (defines data extent).
   * Example: If filter is on A1:C10, this is CellId of A10.
   */
  dataEndCellId: CellId;

  // ===========================================================================
  // Column Filters (keyed by CellId)
  // ===========================================================================

  /**
   * Per-column filter criteria.
   * JSON-serialized Record<CellId, ColumnFilterCriteria>.
   * Keyed by header cell CellId (not column index) for CRDT safety.
   * Stored as string because Yjs doesn't handle nested complex objects well.
   */
  columnFilters: string;

  /**
   * Advanced Filter metadata (JSON-serialized AdvancedFilterState).
   * Present for durable advancedFilter records.
   */
  advancedFilter?: string;

  /**
   * Current sort state (JSON-serialized FilterSortState).
   * Optional - only present if filter has sorting applied.
   * FilterSortState.columnCellId is a CellId, not column index.
   */
  sortState?: string;

  /** Associated table ID for tableFilter type */
  tableId?: string;

  /** When this filter was created (Unix ms) */
  createdAt?: number;

  /** When this filter was last modified (Unix ms) */
  updatedAt?: number;
}

// =============================================================================
// Sheet-Level Map References
// =============================================================================

/**
 * References to all Yjs maps within a single sheet.
 * Used by domain modules to access sheet data without coupling to the store.
 *
 * Cell Identity Model Architecture:
 * - cells: Map<CellId, SerializedCellData> - primary storage by stable ID
 * - properties: Map<CellId, CellProperties> - sparse formatting by ID
 * - grid: Map<"row:col", CellId> - position lookup for rendering
 *
 * Row/Column Identity Model Architecture:
 * - rows: Map<RowId, RowData> - primary storage by stable ID
 * - cols: Map<ColId, ColData> - primary storage by stable ID
 * - rowIndex: Map<"position", RowId> - position lookup
 * - colIndex: Map<"position", ColId> - position lookup
 * - rowHeights: Map<RowId, number> - keyed by identity (stable)
 * - colWidths: Map<ColId, number> - keyed by identity (stable)
 * - rowFormats: Map<RowId, CellFormat> - keyed by identity (stable)
 * - colFormats: Map<ColId, CellFormat> - keyed by identity (stable)
 *
 */
export interface SheetMaps {
  /** Sheet metadata (id, name, frozen rows/cols, etc.) */
  meta: Map<string, unknown>;

  /**
   * Primary cell storage: Map<CellId, SerializedCellData>
   * Cells are keyed by stable UUID. Position is stored in the value.
   * On insert/delete row/col, only position values change - no key changes.
   */
  cells: Map<string, SerializedCellData>;

  /**
   * Cell properties: Map<CellId, CellProperties>
   * Sparse storage - only cells with non-default formatting have entries.
   * Keyed by CellId for CRDT stability (no key changes on structure ops).
   */
  properties: Map<string, CellProperties>;

  /**
   * Position index: Map<"row:col", CellId>
   * Enables O(1) lookup of "what cell is at position X,Y?" for rendering.
   * Derived state, kept in sync within transactions.
   */
  grid: Map<string, CellId>;

  // ===========================================================================
  // Row Identity Model
  // ===========================================================================

  /**
   * Primary row storage: Map<RowId, RowData>
   * Rows are keyed by stable UUID. Position is stored in the value.
   * On insert/delete rows, only position values change - no key changes.
   * Lazily materialized - only rows with custom properties have entries.
   */
  rows: Map<string, RowData> | undefined;

  /**
   * Row position index: Map<"position", RowId>
   * Enables O(1) lookup of "what RowId is at position Y?" for property lookup.
   * Derived state, kept in sync within transactions.
   * Lazily created when first row is materialized.
   */
  rowIndex: Map<string, RowId> | undefined;

  /**
   * Row heights: Map<RowId, number>
   * Keyed by RowId for CRDT stability (no key changes on structure ops).
   * Sparse storage - only rows with custom height have entries.
   */
  rowHeights: Map<string, number>;

  /**
   * Row formats: Map<RowId, CellFormat>
   * Keyed by RowId for CRDT stability (no key changes on structure ops).
   * Sparse storage - only rows with non-default formatting have entries.
   * Used for format inheritance: cell -> row -> column -> default.
   * Lazily created when first row format is set.
   */
  rowFormats: Map<string, CellFormat> | undefined;

  // ===========================================================================
  // Column Identity Model
  // ===========================================================================

  /**
   * Primary column storage: Map<ColId, ColData>
   * Columns are keyed by stable UUID. Position is stored in the value.
   * On insert/delete columns, only position values change - no key changes.
   * Lazily materialized - only columns with custom properties have entries.
   */
  cols: Map<string, ColData> | undefined;

  /**
   * Column position index: Map<"position", ColId>
   * Enables O(1) lookup of "what ColId is at position X?" for property lookup.
   * Derived state, kept in sync within transactions.
   * Lazily created when first column is materialized.
   */
  colIndex: Map<string, ColId> | undefined;

  /**
   * Column widths: Map<ColId, number>
   * Keyed by ColId for CRDT stability (no key changes on structure ops).
   * Sparse storage - only columns with custom width have entries.
   */
  colWidths: Map<string, number>;

  /**
   * Column formats: Map<ColId, CellFormat>
   * Keyed by ColId for CRDT stability (no key changes on structure ops).
   * Sparse storage - only columns with non-default formatting have entries.
   * Used for format inheritance: cell -> row -> column -> default.
   * Lazily created when first column format is set.
   */
  colFormats: Map<string, CellFormat> | undefined;

  // ===========================================================================
  // Other Sheet Data
  // ===========================================================================

  /** Column schemas: Map<colIndex, ColumnSchema> */
  schemas: Map<string, ColumnSchema> | undefined;
  /** Charts: Map<chartId, FloatingObject> — chart-type floating objects */
  charts: Map<string, FloatingObject>;
  /** Range schemas (data validation): Map<schemaId, RangeSchema> */
  rangeSchemas: Map<string, RangeSchema> | undefined;
  /** Effective hidden row indices compatibility cache, derived from owner maps. */
  hiddenRows: Array<number> | undefined;
  /** Manual hidden rows keyed by RowId. */
  manualHiddenRows: Map<string, true> | undefined;
  /** Filter-hidden row ownership: Map<filterId, Map<RowId, true>>. */
  filterHiddenRows: Map<string, Map<string, true>> | undefined;
  /** Hidden column indices (Stream E2): Array of column numbers */
  hiddenCols: Array<number> | undefined;
  /** Excel-style tables (Stream M): Map<tableId, TableConfig> */
  tables: Map<string, TableConfig> | undefined;
  /** Row/column grouping config (Stream O): Map with grouping settings */
  groupingConfig: Map<string, unknown> | undefined;
  /**
   * Merged cell regions: Map<CellId, IdentityMergedRegion>
   * Keyed by topLeftId for O(1) lookup and CRDT-safe concurrent merges.
   * CellId-based storage ensures merges compose correctly under structure changes.
   */
  merges: Map<string, IdentityMergedRegion>;
  /** Floating objects (Stream N): Map<objectId, FloatingObject> */
  floatingObjects: Map<string, FloatingObject> | undefined;
  /** Floating object groups (Stream N): Map<groupId, FloatingObjectGroup> */
  floatingObjectGroups: Map<string, FloatingObjectGroup> | undefined;
  /** Form controls: Map<controlId, FormControl> */
  formControls: Map<string, FormControl> | undefined;
  /** Filters (Layer 0 - Filter State Foundation): Map<filterId, StoredFilterState> */
  filters: Map<string, StoredFilterState> | undefined;
  /**
   * Cell comments (Stream C3 - Comments & Rich Text): Map<commentId, Comment>
   * Comments reference cells via CellId for CRDT-safe structure changes.
   * Lazily created when first comment is added.
   */
  comments: Map<string, Comment> | undefined;
  /**
   * Slicers (Stream ES - Slicers): Map<slicerId, StoredSlicerConfig>
   * Slicers are visual filter controls for Tables and Pivot Tables.
   * Uses Cell Identity Model for column references (CellId, not column index).
   * Lazily created when first slicer is added.
   */
  slicers: Map<string, StoredSlicerConfig> | undefined;
  /**
   * Data bindings for external data connections (Stream DB).
   * Maps binding IDs to data binding configurations.
   * Lazily created when first data binding is added.
   */
  dataBindings: Map<string, unknown> | undefined;
}
