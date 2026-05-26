/**
 * Focus Actor Access
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * States (focus layers):
 * - grid: Base state - grid component handles keyboard events
 * - editor: Cell editor is active (inline cell editor)
 * - formulaBar: Formula bar has focus
 * - dialog: Modal dialog is open
 * - commandPalette: Command palette is open
 * - contextMenu: Context menu is open
 * - formulaPicker: Formula picker during formula editing
 * - sheetTabs: Sheet tabs have focus
 * - formControl: Form control has focus
 *
 * ARCHITECTURE: Selectors are the single primitive for extraction logic.
 * - Snapshots compose selectors (no duplication)
 * - Accessors wrap selectors + getSnapshot() (no duplication)
 * - Hooks use selectors directly with useSelector (no duplication)
 *
 * @see state-machines/src/focus-machine.ts
 * @module @mog-sdk/contracts/actors/focus
 */

import type { FocusLayer } from '../machines/snapshots';
import type { FocusLayerType } from '../machines/types';

// =============================================================================
// STATE TYPE (matches XState snapshot shape)
// =============================================================================

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 */
export interface FocusState {
  context: {
    /** Stack of focus layers. Base grid layer is always at index 0. */
    stack: FocusLayer[];
    /** Last known active grid cell (for restoration after overlays) */
    previousGridCell: { row: number; col: number } | null;
  };
  value: string;
  // Use `any` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

/**
 * FocusAccessor interface for handlers.
 * Mirrors selectors 1:1 with method names (get* prefix for values).
 *
 * This is the contract that handlers use to read focus state.
 */
export interface FocusAccessor {
  // ===========================================================================
  // Value Accessors (match value selectors)
  // ===========================================================================

  /** Get the full focus layer stack */
  getStack(): readonly FocusLayer[];

  /** Get the previous grid cell (for restoration) */
  getPreviousGridCell(): { row: number; col: number } | null;

  // ===========================================================================
  // Derived Accessors
  // ===========================================================================

  /** Get the current (top) focus layer */
  getCurrentLayer(): FocusLayer;

  /** Get the current focus layer type (state name) */
  getState(): FocusLayerType;

  /** Get the stack depth */
  getStackDepth(): number;

  // ===========================================================================
  // State Matching Accessors (match state selectors)
  // ===========================================================================

  /** Check if grid has focus */
  isGridFocused(): boolean;

  /** Check if editor has focus */
  isEditorFocused(): boolean;

  /** Check if formula bar has focus */
  isFormulaBarFocused(): boolean;

  /** Check if a dialog has focus */
  isDialogFocused(): boolean;

  /** Check if command palette has focus */
  isCommandPaletteFocused(): boolean;

  /** Check if context menu has focus */
  isContextMenuFocused(): boolean;

  /** Check if formula picker has focus */
  isFormulaPickerFocused(): boolean;

  /** Check if sheet tabs have focus */
  isSheetTabsFocused(): boolean;

  // ===========================================================================
  // Derived Boolean Accessors
  // ===========================================================================

  /** Check if grid should handle keyboard events */
  shouldGridHandle(): boolean;

  /** Check if focus is in an overlay (not grid or editor) */
  isInOverlay(): boolean;

  /** Check if focus is in any editing state */
  isEditing(): boolean;

  /** Check if focus is in a modal state */
  isInModal(): boolean;
}

// Re-export types for convenience
export type { FocusLayer, FocusLayerType };
