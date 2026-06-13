import { jest } from '@jest/globals';

import { syncRendererZoom } from '../useRendererSync';

function createCoordinator(activeCell: { row: number; col: number } | null) {
  const getActiveCell = jest.fn(() => activeCell);
  const scrollToActiveCell = jest.fn();

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
        scrollToActiveCell,
      },
    } as any,
    getActiveCell,
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
});
