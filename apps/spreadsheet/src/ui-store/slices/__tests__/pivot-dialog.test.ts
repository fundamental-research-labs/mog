import { create } from 'zustand';
import type { PlacementId } from '@mog-sdk/contracts/pivot';

import {
  createPivotDialogSlice,
  DEFAULT_PIVOT_FIELD_PANEL_WIDTH,
  MAX_PIVOT_FIELD_PANEL_WIDTH,
  MIN_PIVOT_FIELD_PANEL_WIDTH,
  type PivotDialogSlice,
} from '../dialogs/pivot-dialog';

function createTestStore() {
  return create<PivotDialogSlice>()(createPivotDialogSlice);
}

function testPlacementId(value: string): PlacementId {
  return value as PlacementId;
}

describe('PivotDialogSlice interaction state', () => {
  it('selects a pivot passively without opening editing', () => {
    const store = createTestStore();

    store.getState().selectPivot('pivot-1');

    expect(store.getState().pivot.selectedPivotId).toBe('pivot-1');
    expect(store.getState().pivot.editingPivotId).toBeNull();
  });

  it('clears selected, editing, and transient overlays when selection leaves pivots', () => {
    const store = createTestStore();

    store.getState().startEditingPivot('pivot-1');
    store.getState().openPivotOverlay({
      kind: 'field-header-menu',
      pivotId: 'pivot-1',
      placementId: testPlacementId('row:Vendor:1'),
    });

    store.getState().selectPivot(null);

    expect(store.getState().pivot).toEqual(
      expect.objectContaining({
        selectedPivotId: null,
        editingPivotId: null,
        openTransientOverlay: null,
        lastOverlayDismissReason: 'selection-change',
      }),
    );
  });

  it('preserves editing when passive selection remains inside the edited pivot', () => {
    const store = createTestStore();

    store.getState().startEditingPivot('pivot-1');
    store.getState().selectPivot('pivot-1');

    expect(store.getState().pivot.selectedPivotId).toBe('pivot-1');
    expect(store.getState().pivot.editingPivotId).toBe('pivot-1');
  });

  it('clears editing when passive selection moves to a different pivot', () => {
    const store = createTestStore();

    store.getState().startEditingPivot('pivot-a');
    store.getState().selectPivot('pivot-b');

    expect(store.getState().pivot.selectedPivotId).toBe('pivot-b');
    expect(store.getState().pivot.editingPivotId).toBeNull();
  });

  it('opening the field panel closes transient pivot overlays centrally', () => {
    const store = createTestStore();

    store.getState().openPivotOverlay({
      kind: 'report-filter-menu',
      pivotId: 'pivot-1',
      placementId: testPlacementId('filter:Vendor:1'),
    });
    store.getState().startEditingPivot('pivot-1');

    expect(store.getState().pivot).toEqual(
      expect.objectContaining({
        selectedPivotId: 'pivot-1',
        editingPivotId: 'pivot-1',
        openTransientOverlay: null,
        lastOverlayDismissReason: 'panel-open',
      }),
    );
  });

  it('opening an overlay activates that pivot without opening editing', () => {
    const store = createTestStore();

    store.getState().startEditingPivot('pivot-a');
    store.getState().openPivotOverlay({
      kind: 'field-header-menu',
      pivotId: 'pivot-b',
      placementId: testPlacementId('row:Vendor:1'),
    });

    expect(store.getState().pivot).toEqual(
      expect.objectContaining({
        selectedPivotId: 'pivot-b',
        editingPivotId: null,
        openTransientOverlay: expect.objectContaining({ pivotId: 'pivot-b' }),
      }),
    );
  });

  it('stopEditingPivot preserves durable selection', () => {
    const store = createTestStore();

    store.getState().startEditingPivot('pivot-1');
    store.getState().stopEditingPivot();

    expect(store.getState().pivot.selectedPivotId).toBe('pivot-1');
    expect(store.getState().pivot.editingPivotId).toBeNull();
  });

  it('stores clamped field panel width', () => {
    const store = createTestStore();

    expect(store.getState().pivot.fieldPanelWidth).toBe(DEFAULT_PIVOT_FIELD_PANEL_WIDTH);

    store.getState().setPivotFieldPanelWidth(MIN_PIVOT_FIELD_PANEL_WIDTH - 100);
    expect(store.getState().pivot.fieldPanelWidth).toBe(MIN_PIVOT_FIELD_PANEL_WIDTH);

    store.getState().setPivotFieldPanelWidth(MAX_PIVOT_FIELD_PANEL_WIDTH + 100);
    expect(store.getState().pivot.fieldPanelWidth).toBe(MAX_PIVOT_FIELD_PANEL_WIDTH);
  });
});
