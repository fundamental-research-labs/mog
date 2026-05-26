/**
 * UI Component Types
 *
 * Kernel-agnostic types for UI components. These types use plain strings
 * for IDs instead of kernel-specific branded types (RowId, ColId, etc.).
 *
 * Design principle: UI components receive data as props with opaque string IDs.
 * The shell layer translates between kernel types and these UI types.
 */

// =============================================================================
// Cell Value Types
// =============================================================================

/**
 * Cell value types supported by UI components.
 * This is a simplified version that covers common display cases.
 *
 * Intentionally different from the canonical `CellValue` in `@mog-sdk/contracts/core`
 * which is `string | number | boolean | null | CellError`. This UI variant includes `Date` and
 * `undefined` for display purposes, and excludes `CellError` (handled separately as `CellValueOrError`).
 *
 * @see `@mog-sdk/contracts/core` for the canonical `CellValue` type.
 */
export type UiCellValue = string | number | boolean | Date | null | undefined;

/**
 * Cell error representation.
 */
export interface CellError {
  type: 'error';
  code: string; // e.g., '#REF!', '#VALUE!'
  message?: string;
}

/**
 * Extended cell value including errors.
 */
export type CellValueOrError = UiCellValue | CellError;

// =============================================================================
// Column Types
// =============================================================================

/**
 * Column type kinds for rendering and editing.
 */
export type ColumnTypeKind =
  | 'text'
  | 'number'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'multiselect'
  | 'person'
  | 'file'
  | 'url'
  | 'email'
  | 'phone'
  | 'rating'
  | 'progress'
  | 'formula'
  | 'createdTime'
  | 'modifiedTime'
  | 'autoNumber'
  | 'relation'
  | 'lookup'
  | 'rollup';

/**
 * Select option for select/multiselect columns.
 */
export interface SelectOption {
  id: string;
  name: string;
  color?: string;
}

/**
 * Column information for UI components.
 */
export interface ColumnInfo {
  /** Column ID (opaque string) */
  id: string;
  /** Display name */
  name: string;
  /** Column type kind */
  type: ColumnTypeKind;
  /** Select options (for select/multiselect) */
  options?: SelectOption[];
  /** Whether column is required */
  required?: boolean;
  /** Position index */
  index: number;
}

// =============================================================================
// Record Types
// =============================================================================

/**
 * A record (row) as seen by UI components.
 * Uses opaque string IDs, not kernel-specific types.
 */
export interface UIRecord {
  /** Record ID (opaque string) */
  id: string;
  /** Values keyed by column name */
  values: Record<string, CellValueOrError>;
  /** Optional: values keyed by column ID */
  valuesByColumnId?: Record<string, CellValueOrError>;
  /** Optional color for the record */
  color?: string;
}

// =============================================================================
// Interaction Types
// =============================================================================

/**
 * Keyboard modifier keys.
 */
export interface KeyModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Selection state for components.
 */
export interface SelectionState {
  /** IDs of selected items */
  selectedIds: string[];
  /** ID of focused item (for keyboard navigation) */
  focusedId: string | null;
}

/**
 * Drag state for components supporting drag and drop.
 */
export interface DragState {
  /** ID of item being dragged */
  draggedId: string | null;
  /** Target drop zone identifier */
  dropTarget: string | null;
  /** Index within drop zone */
  dropIndex: number | null;
}

// =============================================================================
// Filter Types
// =============================================================================

/**
 * Filter operator.
 */
export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'isAnyOf'
  | 'isNoneOf';

/**
 * Filter condition.
 */
export interface FilterCondition {
  /** Column ID or name */
  field: string;
  /** Filter operator */
  operator: FilterOperator;
  /** Value to filter by */
  value?: UiCellValue | UiCellValue[];
}

/**
 * Combined filter (AND logic).
 */
export interface Filter {
  conditions: FilterCondition[];
}

// =============================================================================
// Sort Types
// =============================================================================

/**
 * Sort direction.
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Sort configuration.
 */
export interface SortConfig {
  /** Column ID or name */
  field: string;
  /** Sort direction */
  direction: SortDirection;
}

// =============================================================================
// Common Component Props
// =============================================================================

/**
 * Common props for data view components.
 */
export interface BaseDataViewProps {
  /** Records to display */
  records: UIRecord[];
  /** Column information */
  columns: ColumnInfo[];
  /** Currently selected record IDs */
  selectedIds?: string[];
  /** Currently focused record ID */
  focusedId?: string | null;
  /** Callback when selection changes */
  onSelectionChange?: (selectedIds: string[]) => void;
  /** Callback when a record is clicked */
  onRecordClick?: (recordId: string, modifiers: KeyModifiers) => void;
  /** Callback when a record is double-clicked */
  onRecordDoubleClick?: (recordId: string) => void;
  /** Additional CSS class name */
  className?: string;
}
