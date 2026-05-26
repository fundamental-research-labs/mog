/**
 * Sheet Protection Contracts
 *
 * Defines types for sheet protection, cell locking, and protected operations.
 * These types enable Excel-compatible protection enforcement.
 *
 * @see STREAM-H-EDITOR-PROTECTION.md
 */

// =============================================================================
// Sheet Protection Options
// =============================================================================

/**
 * Sheet protection options - matches Excel/SpreadJS behavior.
 * All flags default to false (operation NOT allowed when protected).
 * The two exceptions are selection flags which default to true.
 *
 * When a sheet is protected:
 * - Operations not explicitly allowed are blocked
 * - Cells with locked: false can still be edited (unless formatCells is also blocked)
 *
 * These options are stored in sheet metadata and preserved in XLSX round-trips.
 */
export interface SheetProtectionOptions {
  // Selection (default: true - users can always select cells)
  /** Can select locked cells (default: true) */
  selectLockedCells: boolean;
  /** Can select unlocked cells (default: true) */
  selectUnlockedCells: boolean;

  // Structure
  /** Can insert new rows */
  insertRows: boolean;
  /** Can insert new columns */
  insertColumns: boolean;
  /** Can insert hyperlinks */
  insertHyperlinks: boolean;
  /** Can delete rows */
  deleteRows: boolean;
  /** Can delete columns */
  deleteColumns: boolean;

  // Content formatting
  /** Can format cells */
  formatCells: boolean;
  /** Can format columns (width, hide/show) */
  formatColumns: boolean;
  /** Can format rows (height, hide/show) */
  formatRows: boolean;

  // Sorting/Filtering
  /** Can sort ranges */
  sort: boolean;
  /** Can use AutoFilter */
  useAutoFilter: boolean;
  /** Can use PivotTable reports */
  usePivotTableReports: boolean;

  // Objects
  /** Can edit objects (charts, shapes, images) */
  editObjects: boolean;
  /** Can edit scenarios */
  editScenarios: boolean;
}

/**
 * Default protection options.
 * All operations blocked except selection.
 */
export const DEFAULT_PROTECTION_OPTIONS: SheetProtectionOptions = {
  // Selection defaults to true (users can always select cells)
  selectLockedCells: true,
  selectUnlockedCells: true,
  // All other operations blocked by default
  insertRows: false,
  insertColumns: false,
  insertHyperlinks: false,
  deleteRows: false,
  deleteColumns: false,
  formatCells: false,
  formatColumns: false,
  formatRows: false,
  sort: false,
  useAutoFilter: false,
  usePivotTableReports: false,
  editObjects: false,
  editScenarios: false,
};

// =============================================================================
// Protected Operations
// =============================================================================

/**
 * Types of operations that can be protected.
 * Used by protection check functions to determine if an operation is allowed.
 */
export type ProtectedOperation =
  | 'editCell'
  | 'insertRows'
  | 'insertColumns'
  | 'deleteRows'
  | 'deleteColumns'
  | 'formatCells'
  | 'formatRows'
  | 'formatColumns'
  | 'sort'
  | 'filter'
  | 'editObject';

/**
 * Result of a protection check.
 */
export interface ProtectionCheckResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Reason why operation was blocked (only set when allowed is false) */
  reason?: 'sheetProtected' | 'cellLocked' | 'operationNotAllowed';
}

// =============================================================================
// Mutation Results
// =============================================================================

/**
 * Result of a mutation operation.
 * Used by Mutations layer to return success/failure with context.
 *
 * Named MutationResult to avoid collision with OperationResult<T> in api.ts.
 * OperationResult is a generic API type with `data` field, while this is
 * a simpler internal type for the coordinator layer.
 */
export interface MutationResult {
  /** Whether the mutation succeeded */
  success: boolean;
  /** Error type if mutation failed */
  error?: 'PROTECTED' | 'INVALID_RANGE' | 'SHEET_NOT_FOUND' | 'VALIDATION_FAILED';
  /** Human-readable error reason */
  reason?: string;
  /** Number of cells/items affected (for success cases) */
  affected?: number;
}

// =============================================================================
// Workbook protection options
// =============================================================================

/**
 * Workbook protection options - matches Excel behavior.
 * Workbook protection prevents structural changes to sheets.
 *
 * When a workbook is protected:
 * - Users cannot add, delete, rename, hide, unhide, or move sheets
 * - Sheet content can still be edited (unless sheet is also protected)
 *
 * Protect Workbook dialog
 */
export interface WorkbookProtectionOptions {
  /**
   * Protect workbook structure (prevents sheet add/delete/move/rename/hide/unhide).
   * Default: true when protection is enabled.
   */
  structure: boolean;
  // Future: windows: boolean; // Protect window position and size (Excel feature, not implemented)
}

/**
 * Default workbook protection options.
 * Structure protection enabled by default.
 */
export const DEFAULT_WORKBOOK_PROTECTION_OPTIONS: WorkbookProtectionOptions = {
  structure: true,
};

/**
 * Types of workbook-level operations that can be protected.
 * Used by protection check functions to determine if an operation is allowed.
 */
export type ProtectedWorkbookOperation =
  | 'addSheet'
  | 'deleteSheet'
  | 'renameSheet'
  | 'moveSheet'
  | 'hideSheet'
  | 'unhideSheet'
  | 'copySheet';
