import { jest } from '@jest/globals';

import { setupViewportFollowCoordination } from '../viewport-follow-coordination';

type SelectionEvent = {
  type: 'userSelectionChanged';
  activeCell: { row: number; col: number };
  followCell: { row: number; col: number };
  suppressViewportFollow?: boolean;
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
      scrollIntent: { type: 'origin', axis: 'both' },
    });

    expect(viewport.getScrollToCell).not.toHaveBeenCalled();
    expect(rendererActor.send).toHaveBeenCalledWith({
      type: 'SCROLL_TO_ORIGIN',
      axis: 'both',
      cell: { row: 0, col: 0 },
    });
  });
});
