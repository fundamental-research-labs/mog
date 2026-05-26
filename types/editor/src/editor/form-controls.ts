/**
 * Form Controls Contracts
 *
 * Type definitions for interactive form controls (Checkbox, Button, ComboBox)
 * that overlay the cell grid and read/write values from linked cells.
 *
 * Architecture Notes:
 * - Form controls are UI widgets for cells, NOT independent data stores
 * - The linked cell is the SINGLE SOURCE OF TRUTH for control values
 * - Controls READ from cell at render time, WRITE to cell on interaction
 * - This eliminates sync loops and makes undo/collaboration automatic
 *
 * Cell Identity Model:
 * - `anchor.cellId` uses CellId for stable positioning (survives row/col changes)
 * - `linkedCellId` uses CellId for stable value binding (survives row/col changes)
 * - Position/value resolution happens at render time via CellPositionLookup
 *
 * Rendering:
 * - Form controls render as HTML overlays (React portals), NOT canvas
 * - This enables native accessibility (keyboard nav, screen readers)
 * - Follows same pattern as in-cell editor overlay
 *
 */

import type { CellId, IdentityRangeRef } from '@mog/types-core/cell-identity';
import type { SheetId } from '@mog/types-core/core';
import type { CellAnchor } from '@mog/types-objects/objects/floating-objects';

// =============================================================================
// Form Control Types
// =============================================================================

/**
 * Form control type discriminator.
 * Used for type narrowing in union types.
 *
 * Supported types:
 * - 'checkbox': Boolean toggle linked to cell (TRUE/FALSE)
 * - 'button': Click action with optional cell write
 * - 'comboBox': Dropdown selection with cell-stored index
 *
 * Future types (not yet implemented):
 * - 'radioButton': Group of mutually exclusive options
 * - 'slider': Numeric range control (different from schema slider)
 * - 'spinner': Numeric increment/decrement control
 */
export type FormControlType =
  | 'checkbox'
  | 'button'
  | 'comboBox'
  | 'radioButton'
  | 'slider'
  | 'spinner';

// =============================================================================
// Base Interface
// =============================================================================

/**
 * Base interface for all form controls.
 * Contains common properties shared by all control types.
 */
export interface FormControlBase {
  /** Unique identifier (UUID) */
  id: string;

  /** Control type discriminator */
  type: FormControlType;

  /** Sheet containing the control */
  sheetId: SheetId;

  /**
   * Position anchor - uses CellId per Cell Identity Model.
   * Control position updates automatically when anchor cell moves.
   */
  anchor: CellAnchor;

  /** Width in pixels */
  width: number;

  /** Height in pixels */
  height: number;

  /** Whether the control is enabled (interactive) */
  enabled: boolean;

  /** Optional name for the control (shown in selection, used in scripts) */
  name?: string;

  /** Z-order for overlapping controls (higher = on top) */
  zIndex: number;

  /** Created timestamp (Unix ms) */
  createdAt?: number;

  /** Last modified timestamp (Unix ms) */
  updatedAt?: number;
}

// =============================================================================
// Checkbox Control
// =============================================================================

/**
 * Checkbox control - reads/writes boolean to linked cell.
 *
 * NO local "checked" state - value lives in cell.
 * This is critical for single source of truth.
 *
 * Data flow:
 * 1. Render: Read from cell → `checked = store.getCellValueById(linkedCellId) === true`
 * 2. Click: Write to cell → `store.setCellValueById(linkedCellId, !checked)`
 * 3. EventBus fires → component re-renders with new value
 *
 * @example
 * // Cell A1 contains TRUE/FALSE
 * // Checkbox linked to A1
 * // Formula =IF(A1, "Yes", "No") works automatically
 */
export interface CheckboxControl extends FormControlBase {
  type: 'checkbox';

  /**
   * REQUIRED - Cell that holds the boolean value.
   * Uses CellId for stability across row/col insert/delete.
   *
   * Expected cell values:
   * - TRUE, true, 1 → checked
   * - FALSE, false, 0, empty → unchecked
   */
  linkedCellId: CellId;

  /** Optional label displayed next to checkbox */
  label?: string;

  /**
   * Value to write when checked.
   * Default: true (boolean TRUE)
   */
  checkedValue?: unknown;

  /**
   * Value to write when unchecked.
   * Default: false (boolean FALSE)
   */
  uncheckedValue?: unknown;
}

// =============================================================================
// Button Control
// =============================================================================

/**
 * Button control - triggers actions on click.
 *
 * Unlike other controls, Button's primary purpose is triggering actions,
 * not storing values. linkedCellId is optional.
 *
 * Use cases:
 * - Increment a counter cell on click
 * - Trigger a macro/script (via actionId)
 * - Navigate to another sheet/location
 */
export interface ButtonControl extends FormControlBase {
  type: 'button';

  /** Button label text */
  label: string;

  /**
   * Optional - Cell to write to on click.
   * Common patterns:
   * - Increment counter: read current value, write value + 1
   * - Toggle: write opposite of current value
   * - Fixed value: write specific value (e.g., timestamp)
   */
  linkedCellId?: CellId;

  /**
   * Action ID for future macro/script integration.
   * Will be used to trigger named actions defined elsewhere.
   */
  actionId?: string;

  /**
   * Value to write to linked cell on click.
   * Only used if linkedCellId is set and clickAction is 'setValue'.
   */
  clickValue?: unknown;

  /**
   * Click behavior when linkedCellId is set.
   * - 'setValue': Write clickValue to cell
   * - 'increment': Add 1 to current numeric value
   * - 'decrement': Subtract 1 from current numeric value
   * - 'toggle': Toggle boolean value
   */
  clickAction?: 'setValue' | 'increment' | 'decrement' | 'toggle';
}

// =============================================================================
// ComboBox Control
// =============================================================================

/**
 * ComboBox control - dropdown selection linked to cell.
 *
 * NO local "selectedIndex" state - value lives in cell.
 * Cell stores the selected VALUE (string), not the index.
 *
 * Data flow:
 * 1. Render: Read from cell → find matching item index
 * 2. Select: Write to cell → `store.setCellValueById(linkedCellId, selectedItem)`
 * 3. EventBus fires → component re-renders with new selection
 *
 * Items can be:
 * - Static: `items: ['Option A', 'Option B', 'Option C']`
 * - Dynamic: `itemsSourceRef: { startId: 'abc', endId: 'xyz' }` (range of cells)
 */
export interface ComboBoxControl extends FormControlBase {
  type: 'comboBox';

  /**
   * REQUIRED - Cell that holds the selected value.
   * Uses CellId for stability across row/col insert/delete.
   *
   * Stores the selected item VALUE (string), not index.
   * This makes formulas like =VLOOKUP(A1, ...) work naturally.
   */
  linkedCellId: CellId;

  /**
   * Static items list.
   * Use this for fixed options that don't change.
   */
  items?: string[];

  /**
   * Dynamic items from a cell range.
   * Uses IdentityRangeRef (CellId-based) for stability.
   * Range values are read at render time.
   *
   * If both `items` and `itemsSourceRef` are set, `itemsSourceRef` takes precedence.
   */
  itemsSourceRef?: IdentityRangeRef;

  /**
   * Placeholder text when no value is selected.
   */
  placeholder?: string;

  /**
   * Whether to allow typing to filter items.
   * Default: true
   */
  filterable?: boolean;
}

// =============================================================================
// Radio Button Control (Future)
// =============================================================================

/**
 * Radio button control - one of multiple mutually exclusive options.
 *
 * Part of a radio group identified by `groupName`.
 * Only one radio in a group can be selected at a time.
 *
 * NOT YET IMPLEMENTED
 */
export interface RadioButtonControl extends FormControlBase {
  type: 'radioButton';

  /**
   * Cell that holds the selected value for this radio group.
   * All radios in the same group share this linkedCellId.
   */
  linkedCellId: CellId;

  /** Group name - radios with same group are mutually exclusive */
  groupName: string;

  /** Value written to cell when this radio is selected */
  value: unknown;

  /** Label displayed next to radio button */
  label?: string;
}

// =============================================================================
// Slider Control (Future)
// =============================================================================

/**
 * Slider control - numeric range selection.
 *
 * Different from schema-based slider (which is an in-cell editor).
 * This is a standalone form control that can be placed anywhere.
 *
 * NOT YET IMPLEMENTED
 */
export interface SliderControl extends FormControlBase {
  type: 'slider';

  /** Cell that holds the numeric value */
  linkedCellId: CellId;

  /** Minimum value */
  min: number;

  /** Maximum value */
  max: number;

  /** Step increment */
  step: number;

  /** Whether to show current value label */
  showValue?: boolean;

  /** Orientation */
  orientation?: 'horizontal' | 'vertical';
}

// =============================================================================
// Spinner Control (Future)
// =============================================================================

/**
 * Spinner control - numeric increment/decrement.
 *
 * NOT YET IMPLEMENTED
 */
export interface SpinnerControl extends FormControlBase {
  type: 'spinner';

  /** Cell that holds the numeric value */
  linkedCellId: CellId;

  /** Minimum value */
  min?: number;

  /** Maximum value */
  max?: number;

  /** Step increment */
  step: number;
}

// =============================================================================
// Union Type
// =============================================================================

/**
 * Union of all implemented form control types.
 *
 * Currently: Checkbox, Button, ComboBox
 * Future: RadioButton, Slider, Spinner
 */
export type FormControl = CheckboxControl | ButtonControl | ComboBoxControl;

/**
 * Union of all form control types (including future).
 */
export type FormControlAny =
  | CheckboxControl
  | ButtonControl
  | ComboBoxControl
  | RadioButtonControl
  | SliderControl
  | SpinnerControl;

// =============================================================================
// Manager Interface
// =============================================================================

/**
 * Options for creating a checkbox control.
 */
export interface CreateCheckboxOptions {
  /** Sheet to create in */
  sheetId: SheetId;
  /** Anchor position (row, col, offsets) - converted to CellId internally */
  anchor: { row: number; col: number; xOffset?: number; yOffset?: number };
  /** Cell to link (row, col) - converted to CellId internally */
  linkedCell: { row: number; col: number };
  /** Optional label */
  label?: string;
  /** Optional size override */
  width?: number;
  height?: number;
}

/**
 * Options for creating a button control.
 */
export interface CreateButtonOptions {
  /** Sheet to create in */
  sheetId: SheetId;
  /** Anchor position */
  anchor: { row: number; col: number; xOffset?: number; yOffset?: number };
  /** Button label */
  label: string;
  /** Optional linked cell for value write */
  linkedCell?: { row: number; col: number };
  /** Click action type */
  clickAction?: 'setValue' | 'increment' | 'decrement' | 'toggle';
  /** Value to write on click (for setValue action) */
  clickValue?: unknown;
  /** Optional size override */
  width?: number;
  height?: number;
}

/**
 * Options for creating a comboBox control.
 */
export interface CreateComboBoxOptions {
  /** Sheet to create in */
  sheetId: SheetId;
  /** Anchor position */
  anchor: { row: number; col: number; xOffset?: number; yOffset?: number };
  /** Cell to link for selected value */
  linkedCell: { row: number; col: number };
  /** Static items list */
  items?: string[];
  /** Dynamic items source range (row/col based, converted to CellId) */
  itemsSource?: {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  };
  /** Placeholder text */
  placeholder?: string;
  /** Optional size override */
  width?: number;
  height?: number;
}

/**
 * Form Control Manager interface.
 *
 * Provides CRUD operations for form controls with Yjs backing.
 * Does NOT store control values - values live in linked cells.
 */
export interface IFormControlManager {
  // -------------------------------------------------------------------------
  // Create Operations
  // -------------------------------------------------------------------------

  /**
   * Create a checkbox control.
   * Converts position-based anchors/links to CellId-based references.
   */
  createCheckbox(options: CreateCheckboxOptions): Promise<CheckboxControl>;

  /**
   * Create a button control.
   */
  createButton(options: CreateButtonOptions): Promise<ButtonControl>;

  /**
   * Create a comboBox control.
   */
  createComboBox(options: CreateComboBoxOptions): Promise<ComboBoxControl>;

  // -------------------------------------------------------------------------
  // Read Operations
  // -------------------------------------------------------------------------

  /**
   * Get a form control by ID.
   */
  getControl(controlId: string): FormControl | undefined;

  /**
   * Get all form controls for a sheet.
   */
  getControlsForSheet(sheetId: SheetId): FormControl[];

  /**
   * Get all form controls in the document.
   */
  getAllControls(): FormControl[];

  // -------------------------------------------------------------------------
  // Update Operations
  // -------------------------------------------------------------------------

  /**
   * Update a form control's properties.
   * Does NOT update the linked cell value - use SpreadsheetStore for that.
   */
  updateControl(
    controlId: string,
    updates: Partial<Omit<FormControl, 'id' | 'type' | 'sheetId'>>,
  ): void;

  /**
   * Move a control to a new anchor position.
   */
  moveControl(
    controlId: string,
    newAnchor: { row: number; col: number; xOffset?: number; yOffset?: number },
  ): Promise<void>;

  /**
   * Resize a control.
   */
  resizeControl(controlId: string, width: number, height: number): void;

  // -------------------------------------------------------------------------
  // Delete Operations
  // -------------------------------------------------------------------------

  /**
   * Delete a form control.
   */
  deleteControl(controlId: string): void;

  /**
   * Delete all form controls for a sheet.
   */
  deleteControlsForSheet(sheetId: SheetId): void;

  // -------------------------------------------------------------------------
  // Utility Operations
  // -------------------------------------------------------------------------

  /**
   * Check if a linked cell still exists.
   * Returns true if cell exists, false if deleted.
   */
  isLinkedCellValid(controlId: string): boolean;

  /**
   * Get controls at a specific position (for hit testing).
   */
  getControlsAtPosition(sheetId: SheetId, row: number, col: number): FormControl[];
}
