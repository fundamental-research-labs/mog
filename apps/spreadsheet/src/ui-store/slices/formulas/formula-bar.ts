/**
 * Formula Bar Slice (7.6: Ctrl+Shift+U Formula Bar Expand/Collapse)
 *
 * Manages formula bar expanded/collapsed state.
 * When expanded, formula bar shows multiple lines for long formulas.
 * Ctrl+Shift+U toggles between single-line (collapsed) and multi-line (expanded) modes.
 *
 * The CSE (Ctrl+Shift+Enter) array-formula registry that previously
 * lived here was deleted: the canonical source is now Rust
 * `compute-core` via the unified `region` field on
 * `ActiveCellData.metadata` (see compute-core `set_array_formula`,
 * `mirror.cse_anchors`, and `mirror.cell_render_at`). The formula
 * bar reads `metadata.region.kind` directly off `activeCellData` —
 * no client-side registry, no `__dt.getCellValue` monkey-patch.
 */

import type { StateCreator } from 'zustand';
import {
  FORMULA_BAR_COLLAPSED_HEIGHT_PX,
  FORMULA_BAR_DEFAULT_EXPANDED_HEIGHT_PX,
  clampFormulaBarHeight,
  isFormulaBarHeightExpanded,
} from '../../../domain/editor/formula-bar-height';

export interface FormulaBarSlice {
  /** Whether the formula bar is expanded (multi-line mode) */
  formulaBarExpanded: boolean;
  /** Current formula bar chrome height in pixels; user-draggable like Excel. */
  formulaBarHeightPx: number;
  /** Toggle formula bar between expanded and collapsed */
  toggleFormulaBarExpand: () => void;
  /** Set formula bar expanded state explicitly */
  setFormulaBarExpanded: (expanded: boolean) => void;
  /** Set formula bar height from drag-resize, clamped to supported chrome bounds. */
  setFormulaBarHeightPx: (heightPx: number) => void;
}

export const createFormulaBarSlice: StateCreator<FormulaBarSlice, [], [], FormulaBarSlice> = (
  set,
) => ({
  formulaBarExpanded: false,
  formulaBarHeightPx: FORMULA_BAR_COLLAPSED_HEIGHT_PX,

  toggleFormulaBarExpand: () => {
    set((s) => {
      const expanded = !s.formulaBarExpanded;
      return {
        formulaBarExpanded: expanded,
        formulaBarHeightPx: expanded
          ? FORMULA_BAR_DEFAULT_EXPANDED_HEIGHT_PX
          : FORMULA_BAR_COLLAPSED_HEIGHT_PX,
      };
    });
  },

  setFormulaBarExpanded: (expanded: boolean) => {
    set({
      formulaBarExpanded: expanded,
      formulaBarHeightPx: expanded
        ? FORMULA_BAR_DEFAULT_EXPANDED_HEIGHT_PX
        : FORMULA_BAR_COLLAPSED_HEIGHT_PX,
    });
  },

  setFormulaBarHeightPx: (heightPx: number) => {
    const clampedHeight = clampFormulaBarHeight(heightPx);
    set({
      formulaBarHeightPx: clampedHeight,
      formulaBarExpanded: isFormulaBarHeightExpanded(clampedHeight),
    });
  },
});
