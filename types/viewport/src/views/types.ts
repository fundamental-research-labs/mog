/**
 * View Types
 *
 * Pure type definitions for the view system (grid, kanban, timeline, etc.).
 * These contracts enable the coordinator to manage views without depending
 * on app-internal view implementations.
 *
 * NOTE: ViewAdapter and ViewAdapterConfig from the app's views/types.ts
 * reference ClipboardPayload and other app-internal types. Only the types
 * that have no app-internal dependencies are included here.
 *
 * @module @mog-sdk/contracts/views
 */

import type { ColId } from '@mog/types-core/cell-identity';
import type { CellFormat } from '@mog/types-core';

// =============================================================================
// IDENTITY TYPES
// =============================================================================

/** Discriminated union of supported view types. */
export type ViewType = 'grid' | 'kanban' | 'timeline' | 'calendar' | 'gallery' | 'form';

/** Branded string type for view identifiers. */
export type ViewId = string & { readonly __brand: 'ViewId' };

/** Identifier for a table backing a view. */
export type TableId = string;

/** Cleanup function returned by subscription methods. */
export type Unsubscribe = () => void;

/** Opaque type for what the user is editing within a view. */
export type EditTarget = unknown;

// =============================================================================
// COLUMN SCHEMA (for type-aware paste and view rendering)
// =============================================================================

/**
 * Column type kinds supported by the system.
 * Used in ViewColumnSchema for type-aware paste and column rendering.
 *
 * NOTE: This is distinct from CellSchemaType in core/schema.ts which describes
 * cell-level data validation types. ColumnTypeKind describes high-level column
 * semantics for view rendering and clipboard operations.
 */
export type ColumnTypeKind =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'checkbox'
  | 'person'
  | 'file'
  | 'url'
  | 'email'
  | 'phone'
  | 'rating'
  | 'progress'
  | 'relation'
  | 'lookup'
  | 'rollup'
  | 'formula'
  | 'createdTime'
  | 'modifiedTime'
  | 'createdBy'
  | 'modifiedBy'
  | 'autoNumber';

/**
 * Select option for select/multi-select columns.
 */
export interface SelectOption {
  id: string;
  label: string;
  color?: string;
}

/**
 * Column schema information for type-aware paste and view rendering.
 *
 * NOTE: This is distinct from ColumnSchema in core/schema.ts which describes
 * cell-level validation schemas. This ColumnSchema describes column metadata
 * for view-layer operations (clipboard, rendering, form fields).
 * Import from the contracts views facade to disambiguate.
 */
export interface ColumnSchema {
  id: ColId;
  name: string;
  kind: ColumnTypeKind;
  required?: boolean;
  unique?: boolean;
  /** For select columns: available options */
  options?: SelectOption[];
  /** For number columns: format config */
  numberFormat?: {
    decimals?: number;
    prefix?: string;
    suffix?: string;
  };
  /** For date columns: include time */
  includeTime?: boolean;
  /** For rating columns: max stars */
  maxRating?: number;
  /** For relation columns: target table */
  targetTableId?: TableId;
  /** Whether the column is read-only (computed columns) */
  readOnly?: boolean;
}

// =============================================================================
// SELECTION
// =============================================================================

/** Current selection state within a view. */
export interface ViewSelection {
  type: ViewType;
  data: unknown;
}

// =============================================================================
// TOOLBAR CONTEXT
// =============================================================================

/**
 * Describes what toolbar actions are available and their current state
 * for the active view. The toolbar UI reads this to enable/disable buttons
 * and show toggle states.
 */
export interface ToolbarContext {
  formatting: {
    canBold: boolean;
    canItalic: boolean;
    canUnderline: boolean;
    canChangeFont: boolean;
    canChangeFontSize: boolean;
    canChangeColor: boolean;
    canChangeFillColor: boolean;
    canChangeAlignment: boolean;
    canChangeBorders: boolean;
  };
  state: {
    isBold: boolean | 'mixed' | null;
    isItalic: boolean | 'mixed' | null;
    isUnderline: boolean | 'mixed' | null;
    fontFamily: string | 'mixed' | null;
    fontSize: number | 'mixed' | null;
    textColor: string | 'mixed' | null;
    fillColor: string | 'mixed' | null;
    horizontalAlign: 'left' | 'center' | 'right' | 'mixed' | null;
    verticalAlign: 'top' | 'middle' | 'bottom' | 'mixed' | null;
  };
  structure: {
    canInsertRow: boolean;
    canDeleteRow: boolean;
    canInsertColumn: boolean;
    canDeleteColumn: boolean;
    canMerge: boolean;
    canUnmerge: boolean;
    canSort: boolean;
    canFilter: boolean;
  };
  selection: {
    hasSelection: boolean;
    selectionCount: number;
    selectionLabel: string;
  };
}

// =============================================================================
// VIEW ADAPTER INTERFACE
// =============================================================================

/**
 * Minimal interface for a view adapter.
 *
 * Each view type (grid, kanban, etc.) implements this interface so the
 * coordinator can manage views uniformly. The full ViewAdapter in the app
 * extends this with clipboard and other app-specific methods.
 */
export interface IViewAdapter {
  readonly viewId: ViewId;
  readonly viewType: ViewType;
  getSelection(): ViewSelection;
  clearSelection(): void;
  selectAll(): void;
  onSelectionChange(listener: (selection: ViewSelection) => void): Unsubscribe;
  isEditing(): boolean;
  startEdit(target: EditTarget): void;
  commitEdit(): Promise<void>;
  cancelEdit(): void;
  getToolbarContext(): ToolbarContext;
  onToolbarContextChange(listener: (ctx: ToolbarContext) => void): Unsubscribe;
  handleKeyboard(event: KeyboardEvent): boolean;
  applyFormatting(format: Partial<CellFormat>): void;
  mount(container: HTMLElement): void;
  unmount(): void;
  dispose(): void;
}

// =============================================================================
// VIEW REGISTRY INTERFACE
// =============================================================================

/**
 * Registry for view type factories.
 * The shell uses this to discover available view types and create adapters.
 */
export interface IViewRegistry {
  get(viewType: ViewType): unknown | undefined;
  list(): ViewType[];
  has(viewType: ViewType): boolean;
  createAdapter(viewType: ViewType, config: unknown): IViewAdapter;
}
