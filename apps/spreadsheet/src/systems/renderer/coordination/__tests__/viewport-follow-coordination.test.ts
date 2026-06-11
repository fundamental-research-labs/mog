import { jest } from '@jest/globals';

import type { CellRange } from '@mog-sdk/contracts/core';

import { setupViewportFollowCoordination } from '../viewport-follow-coordination';

type SelectionEvent = {
  type: 'userSelectionChanged';
  activeCell: { row: number; col: number };
  followCell: { row: number; col: number };
  suppressViewportFollow?: boolean;
  range: CellRange;
  scrollIntent?:
    | {
        type: 'page';
        axis: 'horizontal' | 'vertical';
        direction: 'previous' | 'next';
      }
    | {
        type: 'origin';
        axis: 'horizontal' | 'both';
      };
};

function createSelectionActor() {
  const handlers: Array<(event: SelectionEvent) => void> = [];
  return {
    on: (type: string, handler: (event: SelectionEvent) => void) => {
      if (type === 'userSelectionChanged') handlers.push(handler);
      return {
        unsubscribe: () => {
          const idx = handlers.indexOf(handler);
          if (idx >= 0) handlers.splice(idx, 1);
        },
      };
    },
    emit: (event: SelectionEvent) => {
      for (const handler of [...handlers]) handler(event);
    },
  };
}

describe('viewport-follow coordination', () => {
  it('requests minimal active-cell scroll for ordinary selection movement', () => {
    const selectionActor = createSelectionActor();
    const rendererActor = { send: jest.fn() };
    const viewport = {
      getScrollToCell: jest.fn(() => ({ x: 100, y: 0 })),
      getSnapshot: jest.fn(() => ({
        visibleRange: { startRow: 0, startCol: 0, endRow: 20, endCol: 20 },
      })),
    };

    setupViewportFollowCoordination({
      selectionActor: selectionActor as any,
      rendererActor: rendererActor as any,
      getViewport: () => viewport as any,
    });

    selectionActor.emit({
      type: 'userSelectionChanged',
      activeCell: { row: 0, col: 10 },
      followCell: { row: 0, col: 10 },
      range: { startRow: 0, startCol: 10, endRow: 0, endCol: 10 },
    });

    expect(viewport.getScrollToCell).toHaveBeenCalledWith({ row: 0, col: 10 });
    expect(rendererActor.send).toHaveBeenCalledWith({
      type: 'SCROLL_TO_ACTIVE_CELL',
      cell: { row: 0, col: 10 },
    });
  });

  it('requests page scroll for page-navigation selection movement', () => {
    const selectionActor = createSelectionActor();
    const rendererActor = { send: jest.fn() };
    const viewport = {
      getScrollToCell: jest.fn(() => ({ x: 100, y: 0 })),
    };

    setupViewportFollowCoordination({
      selectionActor: selectionActor as any,
      rendererActor: rendererActor as any,
      getViewport: () => viewport as any,
    });

    selectionActor.emit({
      type: 'userSelectionChanged',
      activeCell: { row: 0, col: 23 },
      followCell: { row: 0, col: 23 },
      range: { startRow: 0, startCol: 23, endRow: 0, endCol: 23 },
      scrollIntent: { type: 'page', axis: 'horizontal', direction: 'previous' },
    });

    expect(viewport.getScrollToCell).not.toHaveBeenCalled();
    expect(rendererActor.send).toHaveBeenCalledWith({
      type: 'SCROLL_PAGE',
      axis: 'horizontal',
      direction: 'previous',
      cell: { row: 0, col: 23 },
    });
  });

  it('does not request active-cell scroll when the selection event suppresses follow', () => {
    const selectionActor = createSelectionActor();
    const rendererActor = { send: jest.fn() };
    const viewport = {
      getScrollToCell: jest.fn(() => ({ x: 0, y: 100 })),
    };

    setupViewportFollowCoordination({
      selectionActor: selectionActor as any,
      rendererActor: rendererActor as any,
      getViewport: () => viewport as any,
    });

    selectionActor.emit({
      type: 'userSelectionChanged',
      activeCell: { row: 7, col: 0 },
      followCell: { row: 7, col: 0 },
      suppressViewportFollow: true,
    });

    expect(viewport.getScrollToCell).not.toHaveBeenCalled();
    expect(rendererActor.send).not.toHaveBeenCalled();
  });

  it('requests origin scroll for Home navigation even when the target is visible', () => {
    const selectionActor = createSelectionActor();
    const rendererActor = { send: jest.fn() };
    const viewport = {
      getScrollToCell: jest.fn(() => null),
    };

    setupViewportFollowCoordination({
      selectionActor: selectionActor as any,
      rendererActor: rendererActor as any,
      getViewport: () => viewport as any,
    });

    selectionActor.emit({
      type: 'userSelectionChanged',
      activeCell: { row: 0, col: 0 },
      followCell: { row: 0, col: 0 },
      range: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
      scrollIntent: { type: 'origin', axis: 'both' },
    });

    expect(viewport.getScrollToCell).not.toHaveBeenCalled();
    expect(rendererActor.send).toHaveBeenCalledWith({
      type: 'SCROLL_TO_ORIGIN',
      axis: 'both',
      cell: { row: 0, col: 0 },
    });
  });

  it('keeps a compact range anchored when the moving edge is visible but the active cell is clipped', () => {
    const selectionActor = createSelectionActor();
    const rendererActor = { send: jest.fn() };
    const viewport = {
      getScrollToCell: jest.fn((cell: { row: number; col: number }) =>
        cell.col === 2 ? { x: 300, y: 0 } : null,
      ),
      getSnapshot: jest.fn(() => ({
        visibleRange: { startRow: 0, startCol: 4, endRow: 20, endCol: 20 },
      })),
    };

    setupViewportFollowCoordination({
      selectionActor: selectionActor as any,
      rendererActor: rendererActor as any,
      getViewport: () => viewport as any,
    });

    selectionActor.emit({
      type: 'userSelectionChanged',
      activeCell: { row: 5, col: 2 },
      followCell: { row: 5, col: 5 },
      range: { startRow: 5, startCol: 2, endRow: 5, endCol: 5 },
    });

    expect(rendererActor.send).toHaveBeenCalledWith({
      type: 'SCROLL_TO_ACTIVE_CELL',
      cell: { row: 5, col: 2 },
    });
  });

  it('continues following the moving edge when the range is wider than the viewport', () => {
    const selectionActor = createSelectionActor();
    const rendererActor = { send: jest.fn() };
    const viewport = {
      getScrollToCell: jest.fn(() => ({ x: 1200, y: 0 })),
      getSnapshot: jest.fn(() => ({
        visibleRange: { startRow: 0, startCol: 0, endRow: 20, endCol: 10 },
      })),
    };

    setupViewportFollowCoordination({
      selectionActor: selectionActor as any,
      rendererActor: rendererActor as any,
      getViewport: () => viewport as any,
    });

    selectionActor.emit({
      type: 'userSelectionChanged',
      activeCell: { row: 0, col: 0 },
      followCell: { row: 0, col: 25 },
      range: { startRow: 0, startCol: 0, endRow: 0, endCol: 25 },
    });

    expect(rendererActor.send).toHaveBeenCalledWith({
      type: 'SCROLL_TO_ACTIVE_CELL',
      cell: { row: 0, col: 25 },
    });
  });
});
