/**
 * View Infrastructure Types
 *
 * Core abstractions that all views implement. These contracts enable:
 * - View-agnostic shell coordination (toolbar, clipboard, focus)
 * - Cross-view interactions (Grid → Kanban paste)
 * - View lifecycle management (caching, switching)
 *
 * 1. Multi-format clipboard - Grid preserves formulas, Kanban works with records
 * 2. View-agnostic toolbar - No CellRange leaking, uses capability flags
 * 3. Adapter caching - unmount() keeps state, dispose() cleans up fully
 * 4. View registry - Pluggable view system, no Grid-specific shell code
 */

import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellData, CellFormat, CellValue, SheetId } from '@mog-sdk/contracts/core';
import type React from 'react';

import type { ClipboardPayload } from '../domain/clipboard/types';

/**
 * Table identifier (tables use string IDs).
 * Using a type alias for future-proofing if we add branded types.
 */
export type TableId = string;

// =============================================================================
// View Types
// =============================================================================

/**
 * View types supported by the shell.
 * Grid is just the first registered view - no special treatment.
 */
export type ViewType = 'grid' | 'kanban' | 'timeline' | 'calendar' | 'gallery' | 'form';

/**
 * Branded type for view IDs (unique instance identifier).
 * Multiple views of the same type can exist (e.g., two Grid views of different tables).
 */
export type ViewId = string & { readonly __brand: 'ViewId' };

/**
 * Rendering mode for view types.
 * - 'imperative': Uses ViewAdapter.mount()/unmount() with createRoot() (for canvas-based views like Grid)
 * - 'react': Renders directly in React tree (for all React-based views)
 */
export type ViewRenderingMode = 'imperative' | 'react';

/**
 * Props for React-based view components.
 * These views render directly in the React tree without an adapter.
 */
export interface ReactViewProps {
  viewId: ViewId;
  tableId?: TableId;
  sheetId: SheetId;
  config: Record<string, unknown>;
}

/**
 * React view component type.
 */
export type ReactViewComponent = React.ComponentType<ReactViewProps>;

// =============================================================================
// Clipboard Data (DEPRECATED - Use ClipboardPayload from ../clipboard/types)
// =============================================================================

/**
 * @deprecated Use ClipboardPayload from '../domain/clipboard/types' instead.
 *
 * This interface is kept for reference and documentation of the original design.
 * All view adapters should use ClipboardPayload (getClipboardPayload, canPaste, paste).
 *
 * View clipboard data with multiple formats for cross-view compatibility.
 *
 * Design principle: Views PRODUCE what they can, CONSUME what they understand.
 *
 * Example flows:
 * - Grid → Grid: Prefers `cells` (preserves formulas), falls back to `records`
 * - Grid → Kanban: Uses `records` format (table-aware)
 * - Kanban → Grid: Uses `records` format, Grid pastes as values
 * - Any → External: Uses `text` format
 *
 * Why `cells` format is critical:
 * - Grid selection can span non-table areas (Level 0 raw sheet data)
 * - Grid → Grid paste must preserve formulas, not just computed values
 * - Without `cells`, copying `=A1+B1` gives you the VALUE, not the formula
 */
export interface ViewClipboardData {
  /** Source view information */
  source: {
    viewType: ViewType;
    viewId: ViewId;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Format 1: Cells (for formula-preserving paste, raw sheet data)
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Cell-based format preserving formulas and all cell properties.
   * Used when: Grid → Grid paste, copying from non-table regions.
   * Contains: raw, formula, identityFormula, computed values.
   */
  cells?: {
    sheetId: SheetId;
    origin: { row: number; col: number };
    /** 2D array of cell data [row][col] */
    data: CellData[][];
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Format 2: Records (for table-aware views)
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Record-based format for table-structured data.
   * Used when: Grid table region → Kanban, Kanban → Grid.
   * Contains: computed values only (no formulas).
   */
  records?: {
    tableId: TableId;
    rowIds: RowId[];
    columns: ColId[];
    /** Map: rowId → (colId → computed value) */
    values: Map<RowId, Map<ColId, CellValue>>;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Format 3: Plain text (always present - for external paste)
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Plain text representation (TSV format).
   * Always present for external paste (e.g., to Excel, Google Sheets, text editor).
   */
  text: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // View-specific format (for paste back to same view type)
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * View-specific clipboard data (e.g., Kanban card positions, Timeline bar styles).
   * Only the originating view type understands this format.
   */
  viewSpecific?: unknown;
}

// =============================================================================
// Selection Types
// =============================================================================

/**
 * View-agnostic selection representation.
 * Each view type provides its own selection in a common format.
 */
export interface ViewSelection {
  /** Type of view (for type-safe casting if needed) */
  type: ViewType;
  /** View-specific selection data */
  data: unknown;
}

// =============================================================================
// Toolbar Context (CRITICAL - View-Agnostic Toolbar State)
// =============================================================================

/**
 * View-agnostic toolbar state.
 *
 * Problem: Toolbar is Shell-level, but CellRange is Grid-specific.
 * Solution: Views expose capabilities + current state, not internal types.
 *
 * Design principle: Toolbar NEVER sees CellRange, CardId, or any view-specific type.
 *
 * State semantics:
 * - boolean: definite state (all selected items have this property)
 * - 'mixed': some items true, some false (e.g., some cells bold, some not)
 * - null: not applicable (e.g., Kanban card selected, font size meaningless)
 */
export interface ToolbarContext {
  // ═══════════════════════════════════════════════════════════════════════════
  // Formatting capabilities - what CAN the view do?
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Current state - what IS the current selection's state?
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Structure capabilities
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Selection info (view-agnostic)
  // ═══════════════════════════════════════════════════════════════════════════
  selection: {
    hasSelection: boolean;
    /** Count of selected items (cells, cards, bars, etc.) */
    selectionCount: number;
    /** Human-readable label: "A1:B5", "3 cards", "2 tasks", etc. */
    selectionLabel: string;
  };
}

/**
 * Get a default ToolbarContext with all capabilities disabled.
 * Useful for initialization before a view is ready.
 */
export function getDefaultToolbarContext(): ToolbarContext {
  return {
    formatting: {
      canBold: false,
      canItalic: false,
      canUnderline: false,
      canChangeFont: false,
      canChangeFontSize: false,
      canChangeColor: false,
      canChangeFillColor: false,
      canChangeAlignment: false,
      canChangeBorders: false,
    },
    state: {
      isBold: null,
      isItalic: null,
      isUnderline: null,
      fontFamily: null,
      fontSize: null,
      textColor: null,
      fillColor: null,
      horizontalAlign: null,
      verticalAlign: null,
    },
    structure: {
      canInsertRow: false,
      canDeleteRow: false,
      canInsertColumn: false,
      canDeleteColumn: false,
      canMerge: false,
      canUnmerge: false,
      canSort: false,
      canFilter: false,
    },
    selection: {
      hasSelection: false,
      selectionCount: 0,
      selectionLabel: '',
    },
  };
}

// =============================================================================
// View Adapter (Core Contract)
// =============================================================================

/**
 * Unsubscribe function returned by event listeners.
 */
export type Unsubscribe = () => void;

/**
 * Edit target (view-specific, passed to startEdit()).
 * Grid: { row, col }, Kanban: { cardId, fieldId }, etc.
 */
export type EditTarget = unknown;

/**
 * ViewAdapter - The contract every view implements.
 *
 * Design principle: Shell coordinates through adapters, never touching view internals.
 *
 * Lifecycle support (CRITICAL for view caching):
 * - mount(container): Attach to DOM (may be resuming from cache)
 * - unmount(): Detach from DOM, KEEP state (scroll, selection, etc.)
 * - dispose(): Full cleanup when view is deleted (not just switched away)
 *
 * This enables fast view switching without losing state.
 */
export interface ViewAdapter {
  // ═══════════════════════════════════════════════════════════════════════════
  // Identity
  // ═══════════════════════════════════════════════════════════════════════════
  readonly viewId: ViewId;
  readonly viewType: ViewType;

  // ═══════════════════════════════════════════════════════════════════════════
  // Selection contract
  // ═══════════════════════════════════════════════════════════════════════════
  getSelection(): ViewSelection;
  clearSelection(): void;
  selectAll(): void;
  onSelectionChange(listener: (selection: ViewSelection) => void): Unsubscribe;

  // ═══════════════════════════════════════════════════════════════════════════
  // Clipboard contract (uses canonical ClipboardPayload format)
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Export current selection to canonical ClipboardPayload format.
   * All views MUST implement this with the new ClipboardPayload type.
   * Async because record-based views may need to fetch data from ComputeBridge.
   */
  getClipboardPayload(): ClipboardPayload | Promise<ClipboardPayload>;

  /**
   * Check if the view can paste the given payload.
   */
  canPaste(payload: ClipboardPayload): boolean;

  /**
   * Paste from canonical ClipboardPayload format.
   * May be async for views that create records via Kernel API.
   */
  paste(payload: ClipboardPayload): void | Promise<void>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Edit contract
  // ═══════════════════════════════════════════════════════════════════════════
  isEditing(): boolean;
  startEdit(target: EditTarget): void;
  commitEdit(): Promise<void>;
  cancelEdit(): void;

  // ═══════════════════════════════════════════════════════════════════════════
  // Toolbar contract (CRITICAL - View-agnostic toolbar state)
  // ═══════════════════════════════════════════════════════════════════════════
  getToolbarContext(): ToolbarContext;
  onToolbarContextChange(listener: (ctx: ToolbarContext) => void): Unsubscribe;

  // ═══════════════════════════════════════════════════════════════════════════
  // Keyboard contract
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Handle keyboard event.
   * @returns true if handled, false if not (allows keyboard event bubbling)
   */
  handleKeyboard(event: KeyboardEvent): boolean;

  // ═══════════════════════════════════════════════════════════════════════════
  // Formatting contract
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Apply formatting to current selection.
   * View decides how to interpret and apply formatting (e.g., Grid applies to cells).
   */
  applyFormatting(format: Partial<CellFormat>): void;

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle (CRITICAL - Adapter caching support)
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Attach adapter to DOM container.
   * May be called multiple times if view is cached (user switches away and back).
   * Adapter should handle resuming from detached state.
   */
  mount(container: HTMLElement): void;

  /**
   * Detach adapter from DOM, but KEEP internal state.
   * Called when user switches to another view.
   * Selection, scroll position, etc. should be preserved.
   */
  unmount(): void;

  /**
   * Full cleanup when view is permanently deleted (not just switched away).
   * Called when user deletes the view or closes the workbook.
   * All resources (actors, subscriptions, etc.) should be cleaned up.
   */
  dispose(): void;
}

// =============================================================================
// View Configuration
// =============================================================================

/**
 * Base configuration for all view types.
 */
export interface ViewConfigBase {
  /** View instance ID */
  viewId: ViewId;
  /** Table this view is bound to (if applicable) */
  tableId?: TableId;
  /** Sheet this view operates on */
  sheetId: SheetId;
}

/**
 * Grid view configuration.
 */
export interface GridViewConfig extends ViewConfigBase {
  frozenRows?: number;
  frozenColumns?: number;
  rowHeight?: 'compact' | 'medium' | 'tall';
  showRowNumbers?: boolean;
  showGridlines?: boolean;
}

/**
 * Kanban view configuration.
 */
export interface KanbanViewConfig extends ViewConfigBase {
  /** Column to group cards by (must be select/multi-select type) */
  groupByColumn: ColId;
  /** Column to use as card title */
  cardTitleColumn: ColId;
  /** Fields to show on card (max 5-6 recommended) */
  cardFields: ColId[];
  /** Optional column to color cards by */
  cardColorColumn?: ColId;
  /** Show columns even when they have no cards */
  showEmptyGroups: boolean;
  /** Override default option order (values from the select column) */
  columnOrder?: string[];
  /** Work-in-progress limits per column: { 'In Progress': 3 } */
  wipLimits?: Record<string, number>;
  /** Column values that are collapsed */
  collapsedColumns?: string[];
}

/**
 * Timeline view configuration.
 */
export interface TimelineViewConfig extends ViewConfigBase {
  /** Start date column (required) */
  startDateColumn: ColId;
  /** End date column (optional, defaults to start date for milestones) */
  endDateColumn?: ColId;
  /** Column to use as bar title/label */
  titleColumn: ColId;
  /** Column to group bars by (optional) */
  groupByColumn?: ColId;
  /** Column to determine bar color (optional) */
  colorByColumn?: ColId;
  /** Time scale: day, week, month, quarter, year */
  timeScale: 'day' | 'week' | 'month' | 'quarter' | 'year';
  /** Visible range start date (optional, auto-calculated from data) */
  startDate?: Date;
  /** Visible range end date (optional, auto-calculated from data) */
  endDate?: Date;
  /** Row height in pixels (default 40) */
  rowHeight?: number;
  /** Width of the left label column in pixels (default 200) */
  labelColumnWidth?: number;
  /** Whether to show today marker (default true) */
  showTodayMarker?: boolean;
  /** Whether to shade weekends (default true for day scale) */
  showWeekends?: boolean;
}

/**
 * Calendar view configuration.
 */
export interface CalendarViewConfig extends ViewConfigBase {
  /** Date column for calendar positioning */
  dateColumn: ColId;
  /** Calendar mode: month, week, day */
  calendarMode: 'month' | 'week' | 'day';
}

/**
 * Gallery view configuration.
 */
export interface GalleryViewConfig extends ViewConfigBase {
  /** Optional column containing cover image (file/attachment column) */
  coverImageColumn?: ColId;
  /** Column to use as card title */
  titleColumn: ColId;
  /** Fields to show on card below the title */
  cardFields: ColId[];
  /** Card size: small (150px), medium (200px), large (280px) */
  cardSize: 'small' | 'medium' | 'large';
  /** How to fit cover image: 'cover' (fill) or 'contain' (fit) */
  fitMode: 'cover' | 'contain';
}

/**
 * Configuration for a single form field.
 */
export interface FormFieldConfig {
  /** Column ID this field maps to */
  colId: ColId;
  /** Override label (defaults to column name) */
  label?: string;
  /** Placeholder text for empty fields */
  placeholder?: string;
  /** Help text shown below the field */
  helpText?: string;
  /** Whether field is required (overrides column schema) */
  required?: boolean;
  /** Whether field is hidden (pre-filled but not shown) */
  hidden?: boolean;
  /** Default value for new records */
  defaultValue?: CellValue;
}

/**
 * Form view configuration.
 */
export interface FormViewConfig extends ViewConfigBase {
  /** Form title displayed at the top */
  title: string;
  /** Optional description below the title */
  description?: string;
  /** Fields to include in the form */
  fields: FormFieldConfig[];
  /** Submit button text */
  submitButtonText: string;
  /** Message shown after successful submission */
  successMessage: string;
  /** Whether to show asterisk on required fields */
  showRequiredIndicator: boolean;
  /** Form layout: single column or two columns */
  layout: 'single' | 'two-column';
}

/**
 * View config by type (discriminated union).
 */
export type ViewConfig<T extends ViewType> = T extends 'grid'
  ? GridViewConfig
  : T extends 'kanban'
    ? KanbanViewConfig
    : T extends 'timeline'
      ? TimelineViewConfig
      : T extends 'calendar'
        ? CalendarViewConfig
        : T extends 'gallery'
          ? GalleryViewConfig
          : T extends 'form'
            ? FormViewConfig
            : never;

// =============================================================================
// View Adapter Configuration
// =============================================================================

/**
 * Configuration passed to createAdapter() when instantiating a view.
 */
export interface ViewAdapterConfig<T extends ViewType = ViewType> {
  /** View instance ID */
  viewId: ViewId;
  /** Table ID if view is table-bound */
  tableId?: TableId;
  /**
   * View-specific configuration.
   * When T is narrowed to a specific view type, this is the exact config type.
   * When T is the full ViewType union (e.g., from ViewRegistry.get()), this also
   * accepts ViewConfigBase & Record<string, unknown> to support config objects
   * built by spreading defaultConfig with runtime overrides.
   */
  config: ViewConfig<T> | (ViewConfigBase & Record<string, unknown>);
  /** Workbook API for data access */
  workbook: WorkbookInternal;
  /** Shell UI store (for dialogs, navigation, etc.) */
  uiStore: unknown; // ShellUIStore - avoid circular dep, defined in shell/ui-store
}

// =============================================================================
// View Definition (Registration)
// =============================================================================

/**
 * ViewDefinition - How views are registered in the ViewRegistry.
 *
 * Grid is registered using this same interface - no special treatment.
 */
export interface ViewDefinition<T extends ViewType = ViewType> {
  /** View type identifier */
  type: T;
  /** Human-readable name */
  name: string;
  /** Icon identifier (from icon library) */
  icon: string;
  /** Description shown in view picker */
  description: string;
  /** Required column types for this view (e.g., Kanban needs 'select' column) */
  requiredColumns?: string[];
  /** Default configuration for new views of this type */
  defaultConfig: Partial<ViewConfig<T>>;

  /**
   * How this view is rendered.
   * - 'imperative': Uses adapter.mount()/unmount() with createRoot()
   * - 'react': Renders directly in React tree
   */
  renderingMode: ViewRenderingMode;

  /**
   * Create adapter instance (required for imperative mode, optional for react mode).
   * For react mode, this is still used for clipboard/toolbar/keyboard contracts.
   */
  createAdapter(config: ViewAdapterConfig<T>): ViewAdapter;

  /**
   * React component (required for react mode, not used for imperative mode).
   * For react mode views, this component renders directly in the tree.
   */
  component?: ReactViewComponent;
}
