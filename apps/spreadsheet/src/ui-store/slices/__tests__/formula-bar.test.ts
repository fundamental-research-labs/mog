/**
 * Formula Bar Slice Tests
 *
 * Covers the shared height contract used by both Ctrl+Shift+U expansion and
 * Excel-style drag resizing.
 */

import { create } from 'zustand';

import {
  FORMULA_BAR_COLLAPSED_HEIGHT_PX,
  FORMULA_BAR_DEFAULT_EXPANDED_HEIGHT_PX,
  FORMULA_BAR_MAX_HEIGHT_PX,
} from '../../../domain/editor/formula-bar-height';
import { createFormulaBarSlice, type FormulaBarSlice } from '../formulas/formula-bar';

function createTestStore() {
  return create<FormulaBarSlice>()(createFormulaBarSlice);
}

describe('FormulaBarSlice', () => {
  it('starts collapsed at the collapsed chrome height', () => {
    const store = createTestStore();

    expect(store.getState().formulaBarExpanded).toBe(false);
    expect(store.getState().formulaBarHeightPx).toBe(FORMULA_BAR_COLLAPSED_HEIGHT_PX);
  });

  it('keeps Ctrl+Shift+U expansion and height in sync', () => {
    const store = createTestStore();

    store.getState().toggleFormulaBarExpand();
    expect(store.getState().formulaBarExpanded).toBe(true);
    expect(store.getState().formulaBarHeightPx).toBe(FORMULA_BAR_DEFAULT_EXPANDED_HEIGHT_PX);

    store.getState().toggleFormulaBarExpand();
    expect(store.getState().formulaBarExpanded).toBe(false);
    expect(store.getState().formulaBarHeightPx).toBe(FORMULA_BAR_COLLAPSED_HEIGHT_PX);
  });

  it('marks drag-resized heights above collapsed as expanded', () => {
    const store = createTestStore();

    store.getState().setFormulaBarHeightPx(FORMULA_BAR_COLLAPSED_HEIGHT_PX + 64);

    expect(store.getState().formulaBarExpanded).toBe(true);
    expect(store.getState().formulaBarHeightPx).toBe(FORMULA_BAR_COLLAPSED_HEIGHT_PX + 64);
  });

  it('clamps drag-resized heights to supported bounds', () => {
    const store = createTestStore();

    store.getState().setFormulaBarHeightPx(1);
    expect(store.getState().formulaBarExpanded).toBe(false);
    expect(store.getState().formulaBarHeightPx).toBe(FORMULA_BAR_COLLAPSED_HEIGHT_PX);

    store.getState().setFormulaBarHeightPx(FORMULA_BAR_MAX_HEIGHT_PX + 1000);
    expect(store.getState().formulaBarExpanded).toBe(true);
    expect(store.getState().formulaBarHeightPx).toBe(FORMULA_BAR_MAX_HEIGHT_PX);
  });

  it('normalizes invalid resize values back to the collapsed state', () => {
    const store = createTestStore();

    store.getState().setFormulaBarExpanded(true);
    store.getState().setFormulaBarHeightPx(Number.NaN);

    expect(store.getState().formulaBarExpanded).toBe(false);
    expect(store.getState().formulaBarHeightPx).toBe(FORMULA_BAR_COLLAPSED_HEIGHT_PX);
  });
});
