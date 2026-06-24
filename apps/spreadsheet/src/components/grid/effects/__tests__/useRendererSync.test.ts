import { jest } from '@jest/globals';

import { persistInputZoomForSheet, syncRendererZoom } from '../useRendererSync';

function createCoordinator(activeCell: { row: number; col: number } | null, zoom = 1.0) {
  const getActiveCell = jest.fn(() => activeCell);
  const scrollToActiveCell = jest.fn();
  const getZoom = jest.fn(() => zoom);

  return {
    coordinator: {
      grid: {
        access: {
          accessors: {
            selection: {
              getActiveCell,
            },
          },
        },
      },
      renderer: {
        getZoom,
        scrollToActiveCell,
      },
    } as any,
    getActiveCell,
    getZoom,
    scrollToActiveCell,
  };
}

describe('syncRendererZoom', () => {
  it('applies zoom before scrolling the active cell back into view', () => {
    const setZoom = jest.fn();
    const activeCell = { row: 458, col: 1 };
    const { coordinator, getActiveCell, scrollToActiveCell } = createCoordinator(activeCell);

    syncRendererZoom({ currentZoom: 1.25, coordinator, setZoom });

    expect(setZoom).toHaveBeenCalledWith(1.25);
    expect(getActiveCell).toHaveBeenCalledTimes(1);
    expect(scrollToActiveCell).toHaveBeenCalledWith(activeCell);
    expect(setZoom.mock.invocationCallOrder[0]).toBeLessThan(
      scrollToActiveCell.mock.invocationCallOrder[0],
    );
  });

  it('does not request a scroll when there is no active cell', () => {
    const setZoom = jest.fn();
    const { coordinator, scrollToActiveCell } = createCoordinator(null);

    syncRendererZoom({ currentZoom: 0.75, coordinator, setZoom });

    expect(setZoom).toHaveBeenCalledWith(0.75);
    expect(scrollToActiveCell).not.toHaveBeenCalled();
  });

  it('does not reapply zoom when the renderer already has the requested level', () => {
    const setZoom = jest.fn();
    const { coordinator, getActiveCell, scrollToActiveCell } = createCoordinator(
      { row: 4, col: 2 },
      1.5,
    );

    syncRendererZoom({ currentZoom: 1.5, coordinator, setZoom });

    expect(setZoom).not.toHaveBeenCalled();
    expect(getActiveCell).not.toHaveBeenCalled();
    expect(scrollToActiveCell).not.toHaveBeenCalled();
  });
});

describe('persistInputZoomForSheet', () => {
  it('persists clamped input zoom for the active sheet', () => {
    const setZoomLevel = jest.fn();
    const persistZoomLevel = jest.fn();

    persistInputZoomForSheet({
      activeSheetId: 'sheet-1',
      zoom: 5,
      currentZoom: 1,
      setZoomLevel,
      persistZoomLevel,
    });

    expect(setZoomLevel).toHaveBeenCalledWith('sheet-1', 4);
    expect(persistZoomLevel).toHaveBeenCalledWith('sheet-1', 4);
  });

  it('skips non-finite and unchanged zoom values', () => {
    const setZoomLevel = jest.fn();

    persistInputZoomForSheet({
      activeSheetId: 'sheet-1',
      zoom: Number.NaN,
      currentZoom: 1,
      setZoomLevel,
    });
    persistInputZoomForSheet({
      activeSheetId: 'sheet-1',
      zoom: 1.00001,
      currentZoom: 1,
      setZoomLevel,
    });

    expect(setZoomLevel).not.toHaveBeenCalled();
  });
});
