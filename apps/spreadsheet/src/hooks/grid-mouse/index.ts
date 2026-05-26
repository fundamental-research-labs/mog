/**
 * Grid Mouse Module
 *
 * Exports types and helpers for the grid mouse hook.
 * This module is the first step in refactoring the monolithic use-grid-mouse.ts hook.
 *
 * Types and Pure Helpers (this file)
 * Event Handler Composition
 * Main Hook Refactoring
 *
 */

// =============================================================================
// Types
// =============================================================================

export type {
  ContextMenuOptions,
  GridMouseEvent,
  UseGridMouseOptions,
  UseGridMouseReturn,
} from './types';

// =============================================================================
// Helper Functions
// =============================================================================

// Click detection helpers
export {
  COMMENT_INDICATOR,
  FILTER_BUTTON,
  VALIDATION_DROPDOWN,
  getSelectedColumnsOrSingle,
  getSelectedRowsOrSingle,
  isClickOnCommentIndicator,
  isClickOnFilterButton,
  isClickOnValidationDropdown,
  type SelectionRange,
} from './helpers/click-detection';

// Cursor position helpers
export {
  calculateCursorPosition,
  calculateCursorPositionWithMeasurer,
  type TextMeasurer,
} from './helpers/cursor-position';

// =============================================================================
// Hooks
// =============================================================================

// Cursor manager hook
export {
  CURSOR_STYLES,
  getCursorForDrag,
  getCursorForHitType,
  useCursorManager,
  type CursorManagerDeps,
  type CursorStyle,
  type UseCursorManagerReturn,
} from './use-cursor-manager';

// Formula range drag hook
export {
  useFormulaRangeDrag,
  type FormulaRangeDragState,
  type UseFormulaRangeDragOptions,
  type UseFormulaRangeDragReturn,
} from './use-formula-range-drag';

// Context menu handler hook
export {
  isCellInSelection,
  isColumnInSelection,
  isMultiCellSelection,
  isRowInSelection,
  useContextMenuHandler,
  type ContextMenuSelectionApi,
  type UseContextMenuHandlerDeps,
  type UseContextMenuHandlerReturn,
} from './use-context-menu-handler';

// Cell interaction hook
export {
  useCellInteraction,
  type CellClickPosition,
  type UseCellInteractionOptions,
  type UseCellInteractionReturn,
} from './use-cell-interaction';

// Warp adjust interaction hook
export {
  calculateWarpAdjustHandlePosition,
  getWarpAdjustCursor,
  isWarpAdjustHandle,
  useWarpAdjustInteraction,
  type UseWarpAdjustInteractionDeps,
  type UseWarpAdjustInteractionReturn,
  type WarpAdjustDragState,
} from './use-warp-adjust-interaction';
