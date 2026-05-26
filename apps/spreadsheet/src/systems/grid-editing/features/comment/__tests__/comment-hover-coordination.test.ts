import { jest } from '@jest/globals';

import { setupCommentHoverCoordination } from '../comment-hover-coordination';

function createMockCommentActor() {
  const sentEvents: Array<{ type: string; [key: string]: unknown }> = [];
  return {
    send: (event: { type: string; [key: string]: unknown }) => {
      sentEvents.push(event);
    },
    getSnapshot: () => ({ value: 'closed' }),
    sentEvents,
  };
}

describe('Comment Hover Coordination', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens the comment popover when hovering over a comment indicator', async () => {
    const commentActor = createMockCommentActor();
    const worksheet = {
      viewport: {
        hasComment: jest.fn(() => true),
      },
      comments: {
        getForCell: jest.fn(async () => [{ cellRef: 'cell-a1' }]),
      },
    };
    const hitTest = {
      atViewportPoint: jest.fn(() => ({ type: 'comment-indicator', row: 0, col: 0 })),
      atPagePoint: jest.fn(() => ({ type: 'comment-indicator', row: 0, col: 0 })),
    };

    const coordination = setupCommentHoverCoordination({
      commentActor: commentActor as any,
      getActiveSheetId: () => 'sheet-1' as any,
      getHitTest: () => hitTest as any,
      getWorksheet: () => worksheet as any,
    });

    coordination.handleMouseMove({ x: 100, y: 10 });
    await jest.advanceTimersByTimeAsync(300);

    expect(commentActor.sentEvents).toEqual([
      {
        type: 'HOVER_CELL',
        target: {
          cellId: 'cell-a1',
          sheetId: 'sheet-1',
          row: 0,
          col: 0,
        },
      },
    ]);

    coordination.cleanup();
  });

  it('opens the comment popover from a DOM indicator overlay without hit-testing', async () => {
    const commentActor = createMockCommentActor();
    const worksheet = {
      comments: {
        getForCell: jest.fn(async () => [{ cellRef: 'cell-a1' }]),
      },
    };

    const coordination = setupCommentHoverCoordination({
      commentActor: commentActor as any,
      getActiveSheetId: () => 'sheet-1' as any,
      getWorksheet: () => worksheet as any,
    });

    coordination.handleIndicatorMouseEnter({ sheetId: 'sheet-1' as any, row: 0, col: 0 });
    await jest.advanceTimersByTimeAsync(300);

    expect(commentActor.sentEvents).toEqual([
      {
        type: 'HOVER_CELL',
        target: {
          cellId: 'cell-a1',
          sheetId: 'sheet-1',
          row: 0,
          col: 0,
        },
      },
    ]);

    coordination.cleanup();
  });
});
